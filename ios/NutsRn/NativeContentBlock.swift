import Foundation
import NipworkerSwift
import UIKit

struct ContentRun {
  let text: String
  let color: UIColor
}

struct QuoteInfo {
  let id: String
  let relays: [String]
  let depth: Int
  let key: String
}

enum ContentLine {
  case text([ContentRun])
  case quote(QuoteInfo)
}

enum NativeContentBlockParser {
  static func build(
    from event: nostr_fb_ParsedEvent,
    baseContentColor: UIColor,
    accentColor: UIColor,
    showQuote: Bool,
    depth: Int,
    resolveRelays: () -> [String]
  ) -> [ContentLine] {
    guard event.kind == 1,
          let kind1 = event.parsed(type: nostr_fb_Kind1Parsed.self) else {
      return [.text([ContentRun(text: "Kind \(event.kind)", color: baseContentColor)])]
    }

    var lines: [ContentLine] = []
    var currentTextRuns: [ContentRun] = []

    func flushText() {
      if !currentTextRuns.isEmpty {
        lines.append(.text(currentTextRuns))
        currentTextRuns.removeAll()
      }
    }

    func appendTextRun(_ run: ContentRun) {
      currentTextRuns.append(run)
    }

    for block in kind1.parsedContent {
      let blockText = normalizeText(block.text)
      switch block.dataType {
      case .none_:
        if !blockText.isEmpty {
          appendTextRun(ContentRun(text: blockText, color: baseContentColor))
        }
      case .nostrdata:
        guard let nostr = block.data(type: nostr_fb_NostrData.self) else { continue }
        let id = nostr.id.trimmingCharacters(in: .whitespacesAndNewlines)
        let entity = nostr.entity.trimmingCharacters(in: .whitespacesAndNewlines)
        let isProfileMention = nostr.author != nil && isUserEntity(entity)
        let isQuote = showQuote && !id.isEmpty && isQuoteEntity(entity) && depth < 3

        if isQuote {
          flushText()
          let quoteRelays = Array(nostr.relays.compactMap { $0 })
          let mergedRelays = quoteRelays.isEmpty ? resolveRelays() : quoteRelays
          let quoteId = "q_\(lines.count)-\(id)"
          lines.append(
            .quote(
              QuoteInfo(
                id: id,
                relays: mergedRelays,
                depth: depth + 1,
                key: quoteId
              )
            )
          )
          continue
        }

        if isProfileMention {
          appendTextRun(ContentRun(text: displayText(entity: entity, id: id, fallback: blockText), color: accentColor))
        } else if isHashtag(blockText) {
          appendTextRun(ContentRun(text: blockText, color: accentColor))
        } else {
          appendTextRun(ContentRun(text: displayText(entity: entity, id: id, fallback: blockText), color: baseContentColor))
        }

      case .hashtagdata:
        if let hashtag = block.data(type: nostr_fb_HashtagData.self) {
          appendTextRun(ContentRun(text: "#\(hashtag.tag)", color: accentColor))
        } else {
          appendTextRun(ContentRun(
            text: blockText.hasPrefix("#") ? blockText : "#\(blockText)",
            color: accentColor
          ))
        }

      case .linkpreviewdata:
        if let preview = block.data(type: nostr_fb_LinkPreviewData.self) {
          let url = preview.url.isEmpty ? blockText : preview.url
          if !url.isEmpty {
            appendTextRun(ContentRun(text: url, color: accentColor))
          }
        }

      case .imagedata:
        if let image = block.data(type: nostr_fb_ImageData.self), !image.url.isEmpty {
          appendTextRun(ContentRun(text: image.url, color: accentColor))
        }

      case .videodata:
        if let video = block.data(type: nostr_fb_VideoData.self), !video.url.isEmpty {
          appendTextRun(ContentRun(text: video.url, color: accentColor))
        }

      case .mediagroupdata:
        if let media = block.data(type: nostr_fb_MediaGroupData.self) {
          for item in media.items {
            if let image = item.image?.url {
              appendTextRun(ContentRun(text: image, color: accentColor))
            } else if let video = item.video?.url {
              appendTextRun(ContentRun(text: video, color: accentColor))
            }
          }
        }

      case .codedata, .cashudata, .emojidata:
        if !blockText.isEmpty {
          appendTextRun(ContentRun(text: blockText, color: baseContentColor))
        }
      }
    }

    flushText()
    return lines
  }

  private static func isUserEntity(_ entity: String) -> Bool {
    entity.hasPrefix("nprofile") || entity.hasPrefix("npub")
  }

  private static func isQuoteEntity(_ entity: String) -> Bool {
    entity.hasPrefix("nevent") || entity.hasPrefix("naddr") || entity.hasPrefix("note") || entity.hasPrefix("event")
  }

  private static func isHashtag(_ value: String) -> Bool {
    value.hasPrefix("#")
  }

  private static func displayText(entity: String, id: String, fallback: String) -> String {
    let trimmed = entity.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { return trimmed }
    let trimmedId = id.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedId.isEmpty { return trimmedId }
    return fallback
  }

  private static func normalizeText(_ value: String) -> String {
    if value.isEmpty { return value }
    let payload = "\"\(value)\""
    guard let data = payload.data(using: .utf8),
          let decoded = try? JSONDecoder().decode(String.self, from: data) else {
      return value.replacingOccurrences(of: "\\\\", with: "\\")
    }
    return decoded
  }
}

