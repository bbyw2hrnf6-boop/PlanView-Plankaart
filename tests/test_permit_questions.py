import copy
import unittest
from unittest.mock import patch

import server
from local_permits import PermitError, clean_permit_question_input

INPUT = {'point': {'lat': 50.85, 'lng': 5.69}, 'query': 'Warum abgelehnt?', 'language': 'de'}
SOURCE = {'id': 'gmb-2026-123', 'text': 'De vergunning is geweigerd.', 'url': 'https://zoek.officielebekendmakingen.nl/gmb-2026-123.html'}
RESULT = {'state': 'matches', 'sources': [SOURCE], 'coverage': {'complete': False, 'warnings': []},
          'answer': None, 'modelConfig': {'schema': {}, 'instructions': 'Use supplied notices only.'}}
INTENT = {'searchQuery': 'weigering en redenen', 'terms': ['weigering', 'redenen'], 'intent': 'refusal_reasons',
          'category': 'general', 'statuses': ['refused'], 'caseReferences': []}


class PermitQuestions(unittest.TestCase):
    def setUp(self):
        server.PERMIT_QUESTION_REQUESTS.clear()
        for target, kwargs in [
                ('backend', {'return_value': 'codex-cli'}),
                ('generate_permit_intent', {'return_value': INTENT}),
                ('enrich_permit_documents', {'side_effect': lambda ranked, *_args, **_kwargs: ranked})]:
            active = patch.object(server, target, **kwargs)
            active.start()
            self.addCleanup(active.stop)

    def test_strict_input_never_accepts_client_evidence_or_global_search(self):
        for extra in [{'sources': []}, {'url': 'https://evil.test'}, {'cursor': 'abc'}, {'language': 'fr'}, {'query': ''}]:
            with self.assertRaises(PermitError):
                clean_permit_question_input({**INPUT, **extra})

    def test_no_connection_keeps_public_sources_and_strips_model_instructions(self):
        with patch.object(server, 'permit_questions_node', return_value=copy.deepcopy(RESULT)), patch.object(server, 'backend', return_value='none'):
            result = server.search_permits(INPUT)
        self.assertEqual(result['sources'], [SOURCE])
        self.assertEqual(result['state'], 'matches')
        self.assertNotIn('modelConfig', result)
        self.assertIn('api_key_missing', result['coverage']['warnings'])

    def test_ai_failure_or_busy_keeps_evidence_and_releases_locks(self):
        for busy in [False, True]:
            if busy:
                server.RUN_LOCK.acquire()
            try:
                with patch.object(server, 'permit_questions_node', return_value=copy.deepcopy(RESULT)), patch.object(server, 'backend', return_value='codex-cli'), patch.object(server, 'generate_permit_answer', side_effect=RuntimeError('provider diagnostic')) as generate:
                    result = server.search_permits(INPUT)
                self.assertEqual(result['sources'], [SOURCE])
                self.assertIn('ai_busy' if busy else 'ai_unavailable', result['coverage']['warnings'])
                self.assertIsNone(result['answer'])
                self.assertEqual(generate.call_count, 0 if busy else 1)
            finally:
                if busy:
                    server.RUN_LOCK.release()
            self.assertFalse(server.PERMIT_QUESTION_LOCK.locked())
            self.assertFalse(server.RUN_LOCK.locked())

    def test_sources_validated_on_server_and_valid_answer_returned(self):
        answer = {'citations': [SOURCE['id']], 'summary': 'Abgelehnt.'}
        def engine(payload):
            if payload['mode'] == 'retrieve':
                self.assertEqual(payload['input'], INPUT)
                return copy.deepcopy(RESULT)
            self.assertEqual(payload['sources'], [SOURCE])
            return answer
        with patch.object(server, 'permit_questions_node', side_effect=engine), patch.object(server, 'backend', return_value='codex-cli'), patch.object(server, 'generate_permit_answer', return_value={'claims': []}):
            result = server.search_permits(INPUT)
        self.assertEqual(result['state'], 'answered')
        self.assertEqual(result['answer'], answer)

    def test_empty_sources_skip_ai_and_question_budget_blocks_upstream(self):
        empty = {**copy.deepcopy(RESULT), 'sources': []}
        with patch.object(server, 'permit_questions_node', return_value=empty), patch.object(server, 'generate_permit_answer', side_effect=AssertionError('No answer AI for empty sources')):
            self.assertEqual(server.search_permits(INPUT)['sources'], [])
        server.PERMIT_QUESTION_REQUESTS[:] = [server.time.monotonic()] * 12
        with patch.object(server, 'permit_questions_node', side_effect=AssertionError('No over-budget call')):
            with self.assertRaises(PermitError) as error:
                server.search_permits(INPUT)
        self.assertEqual((error.exception.status, error.exception.code), (429, 'permit_question_limit'))
        self.assertFalse(server.PERMIT_QUESTION_LOCK.locked())

    def test_unavailable_notice_titles_cannot_be_used_as_body_evidence(self):
        unavailable = {**copy.deepcopy(RESULT), 'sources': [{**SOURCE, 'sourceAvailable': False}]}
        with patch.object(server, 'permit_questions_node', return_value=unavailable), patch.object(server, 'generate_permit_answer', side_effect=AssertionError('No answer AI for title fallback')):
            result = server.search_permits(INPUT)
        self.assertEqual(result['sources'][0]['id'], SOURCE['id'])
        self.assertIsNone(result['answer'])

    def test_intent_precedes_retrieval_and_only_server_intent_is_forwarded(self):
        steps = []
        def planner(value, chosen):
            steps.append('intent')
            self.assertEqual(value, INPUT)
            return INTENT
        def engine(value):
            if value['mode'] == 'retrieve':
                steps.append('retrieve')
                self.assertEqual(value['intent'], INTENT)
                return copy.deepcopy(RESULT)
            steps.append('validate')
            self.assertEqual(value['sources'], [SOURCE])
            return {'citations': [SOURCE['id']], 'summary': 'Belegt.'}
        def docs(ranked, value, deadline_seconds):
            steps.append('documents')
            self.assertEqual(deadline_seconds, 45)
            return ranked
        with patch.object(server, 'generate_permit_intent', side_effect=planner), patch.object(server, 'permit_questions_node', side_effect=engine), patch.object(server, 'enrich_permit_documents', side_effect=docs), patch.object(server, 'generate_permit_answer', return_value={'claims': []}):
            self.assertEqual(server.search_permits(INPUT)['state'], 'answered')
        self.assertEqual(steps, ['intent', 'retrieve', 'documents', 'validate'])

    def test_failed_interpretation_and_pdf_retrieval_keep_notice_evidence(self):
        with patch.object(server, 'generate_permit_intent', side_effect=RuntimeError('private diagnostic')), patch.object(server, 'enrich_permit_documents', side_effect=OSError('private diagnostic')), patch.object(server, 'permit_questions_node', return_value=copy.deepcopy(RESULT)), patch.object(server, 'generate_permit_answer', side_effect=RuntimeError('private diagnostic')):
            result = server.search_permits(INPUT)
        self.assertEqual(result['sources'], [SOURCE])
        self.assertIn('permit_intent_unavailable', result['coverage']['warnings'])
        self.assertIn('permit_documents_unavailable', result['coverage']['warnings'])
        self.assertNotIn('private diagnostic', str(result))


if __name__ == '__main__':
    unittest.main()
