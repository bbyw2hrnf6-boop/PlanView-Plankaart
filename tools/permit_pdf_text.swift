// Local-only PDF text extraction. Input is one server-downloaded file; no networking.
import Foundation
import PDFKit
import Vision
import CoreGraphics

struct PageText: Codable {
    let page: Int
    let text: String
    let ocr: Bool
    let truncated: Bool
    let incomplete: Bool
}
struct Result: Codable {
    let pageCount: Int
    let pages: [PageText]
    let pagesLimited: Bool
    let deadlineReached: Bool
    let textTruncated: Bool
}
enum ExtractError: Error { case invalidInput, invalidPDF }

func emit(_ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

func emitPage(_ page: PageText) throws {
    let data = try JSONEncoder().encode(page)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

func inertText(_ value: String) -> String {
    String(value.unicodeScalars.filter {
        $0.value == 10 || $0.value == 9 || $0.value >= 32 && $0.value != 127
    }).replacingOccurrences(of: "\r\n", with: "\n")
}

func render(_ page: PDFPage) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width.isFinite, bounds.height.isFinite,
          bounds.width > 0, bounds.height > 0,
          bounds.width < 5000, bounds.height < 5000 else { return nil }
    // 144 DPI for normal pages, bounded to 12 million pixels for large drawings.
    let scale = min(2.0, 3600.0 / max(bounds.width, bounds.height),
                    sqrt(12_000_000.0 / (bounds.width * bounds.height)))
    let width = Int(ceil(bounds.width * scale)), height = Int(ceil(bounds.height * scale))
    guard width > 0, height > 0, width * height <= 12_010_000,
          let context = CGContext(data: nil, width: width, height: height,
              bitsPerComponent: 8, bytesPerRow: width * 4,
              space: CGColorSpaceCreateDeviceRGB(),
              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.scaleBy(x: scale, y: scale)
    context.translateBy(x: -bounds.minX, y: -bounds.minY)
    page.draw(with: .mediaBox, to: context)
    return context.makeImage()
}

func run() throws {
    guard CommandLine.arguments.count == 3,
          let seconds = Double(CommandLine.arguments[2]), seconds > 0, seconds <= 90 else {
        throw ExtractError.invalidInput
    }
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard values.isRegularFile == true, let size = values.fileSize,
          size > 0, size <= 12 * 1024 * 1024,
          let document = PDFDocument(url: url), !document.isLocked,
          document.pageCount > 0, document.pageCount <= 2000 else {
        throw ExtractError.invalidPDF
    }
    let end = ProcessInfo.processInfo.systemUptime + seconds
    // Preserve each completed page even if a later native OCR call exceeds its deadline.
    try emit(["type": "header", "pageCount": document.pageCount])
    var pages: [PageText] = []
    var chars = 0, deadlineReached = false, textTruncated = false
    let pageLimit = min(document.pageCount, 24)
    for index in 0..<pageLimit {
        if ProcessInfo.processInfo.systemUptime >= end - 2.0 {
            deadlineReached = true; break
        }
        let value: PageText? = autoreleasepool {
            guard let page = document.page(at: index) else { return nil }
            var extracted = inertText(page.string ?? "")
            var usedOCR = false
            var ocrSucceeded = false
            let letters = extracted.unicodeScalars.filter {
                CharacterSet.alphanumerics.contains($0)
            }.count
            let requiresOCR = letters < 400
            if requiresOCR && ProcessInfo.processInfo.systemUptime < end - 2.0,
               let image = render(page) {
                usedOCR = true
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                request.recognitionLanguages = ["nl-NL", "en-US", "de-DE"]
                if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
                let cancelAfter = max(0.05, end - ProcessInfo.processInfo.systemUptime - 2.0)
                DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + cancelAfter) {
                    request.cancel()
                }
                let handler = VNImageRequestHandler(cgImage: image, options: [:])
                // Vision has no network access; one page at a time bounds memory.
                if (try? handler.perform([request])) != nil {
                    let recognized = (request.results ?? []).compactMap {
                        $0.topCandidates(1).first?.string
                    }.joined(separator: "\n")
                    ocrSucceeded = recognized.unicodeScalars.filter {
                        CharacterSet.alphanumerics.contains($0)
                    }.count >= 60
                    if recognized.count > extracted.count { extracted = inertText(recognized) }
                }
            }
            let remaining = max(0, 240_000 - chars)
            let limit = min(12_000, remaining)
            let truncated = extracted.count > limit
            if truncated { textTruncated = true }
            let bounded = String(extracted.prefix(limit))
            chars += bounded.count
            return PageText(page: index + 1, text: bounded, ocr: usedOCR,
                truncated: truncated, incomplete: requiresOCR && !ocrSucceeded)
        }
        if let value = value {
            pages.append(value)
            try emitPage(value)
        }
        if chars >= 240_000 { textTruncated = true; break }
    }
    let result = Result(pageCount: document.pageCount, pages: pages,
        pagesLimited: pages.count < document.pageCount || pages.contains(where: { $0.incomplete }),
        deadlineReached: deadlineReached, textTruncated: textTruncated)
    try emit(["type": "complete", "pageCount": result.pageCount,
        "pagesLimited": result.pagesLimited, "deadlineReached": result.deadlineReached,
        "textTruncated": result.textTruncated])
}
do { try run() }
catch {
    FileHandle.standardError.write(Data("permit_document_extraction_failed\n".utf8))
    exit(1)
}
