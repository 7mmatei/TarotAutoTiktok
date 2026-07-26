# TikTok LIVE compliance design

This document records the product decisions derived from TikTok's official guidance as checked on 2026-07-26. It is an engineering control set, not a promise that TikTok will approve a LIVE or refrain from enforcement.

## Official requirements used

- TikTok lists LIVE sessions as For You feed ineligible when they pressure viewers for Gifts or engagement, stream unoriginal material without creative changes, repeat prolonged actions without clear objectives or direct interaction, or show low-quality output: <https://www.tiktok.com/community-guidelines/en/accounts-features?cgversion=2025H2update&lang=en>
- TikTok's integrity rules make reused material without something new ineligible and prohibit deceptive engagement incentives: <https://www.tiktok.com/community-guidelines/en/integrity-authenticity/>
- TikTok encourages creators to disclose content generated or significantly edited by AI and requires disclosure for realistic AI content: <https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content>
- TikTok Shop's region-specific LIVE guidance describes computer-generated voices and looping/static scenes without sustained real-time verbal engagement as non-interactive content. It applies to the region named on that page, but it is a useful warning about how TikTok evaluates automation: <https://seller-sg.tiktok.com/university/essay?knowledge_id=7651420422047489&lang=en>

## Automated controls implemented

1. TikFinity `member` packets become `JOIN` events. Mora visibly reacts to the named viewer instead of treating the packet as an error.
2. TikFinity `roomUser` packets become `ROOM_STATS` events. The renderer reflects the live audience count.
3. Safe comments enter a bounded interaction queue even during a reading. They are not silently lost because another audio clip is active.
4. Gemini Flash-Lite creates a short response grounded in the viewer's actual comment. The prompt and output validator reject requests for Gifts, likes, follows, shares, certainty, diagnoses, or predictions.
5. A deterministic safe response is used only when the Gemini interaction call fails. The failure remains visible in the audit log as `LLM_INTERACTION_FAILED`.
6. Comment TTS is played between readings. Reading playback waits while a queued viewer response is being generated or spoken.
7. Idle CTA audio cannot loop in an empty room. One CTA may play only after a new real viewer event, within two minutes of that event, and a second CTA requires another viewer event.
8. The broadcast permanently discloses that Mora is virtual, the reading is AI-generated, the content is entertainment/reflection, and Gifts are optional.
9. The renderer remains native 1080×1920 and event-driven. Join, follow, comment, like, Gift, reading, and room-count changes produce distinct visible states.

## Remaining boundary

TikTok makes the enforcement decision, and no animation cadence, randomized scene, TTS library, or event adapter can guarantee acceptance. The system is designed to create real, viewer-specific responses rather than imitate activity. Do not add fake chat events, simulated viewers, repeated prerecorded segments, or logic intended to disguise automation.

The most automated defensible operating model is:

- the application handles ingestion, moderation, Gemini generation, cards, TTS, animation, and playback;
- the LIVE is stopped when TikFinity is disconnected, the renderer is degraded, or TikTok displays a warning;
- the creator monitors the LIVE and can speak naturally when needed, especially during quiet periods or moderation incidents.

Fully unattended output made only of a virtual character and computer-generated speech remains at elevated enforcement risk under TikTok's published guidance.

## Release test

Before another public test:

1. Make a ten-minute local OBS recording at 1080×1920.
2. Replay fixtures for `member`, `roomUser`, `comment`, `follow`, all four mapped Gifts, and a LIKE burst.
3. Confirm `/api/provider-events` marks `member` as `JOIN` and `roomUser` as `ROOM_STATS`, not rejected.
4. Post three different safe comments during a reading. Confirm each enters `INTERACTION_QUEUED` and receives a comment-specific response between readings.
5. Leave the system with no events for five minutes. Confirm no idle CTA repeats.
6. Confirm the footer disclosure remains readable in a 360×640 preview.
7. Confirm no spoken output asks for Gifts, likes, follows, or shares.
8. Use TikTok's own AI/commercial disclosure settings when they apply to the account and LIVE.
