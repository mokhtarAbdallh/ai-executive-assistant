import type { SpeechToText, TranscribeOptions, TranscriptionResult } from "../types.js";

export class SpeechmaticsSpeechToText implements SpeechToText {
  public readonly providerName = "speechmatics";

  async transcribe(
    _audio: Buffer | Uint8Array | string,
    _options?: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    throw new Error(
      "Speechmatics provider is currently in evaluation (ADR-005). Please use ASR_PROVIDER=fake or ASR_PROVIDER=elevenlabs.",
    );
  }
}

export class WhisperSpeechToText implements SpeechToText {
  public readonly providerName = "whisper-http";

  async transcribe(
    _audio: Buffer | Uint8Array | string,
    _options?: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    throw new Error(
      "Self-hosted Whisper HTTP provider is planned for Phase 7 (ADR-005). Please use ASR_PROVIDER=fake or ASR_PROVIDER=elevenlabs.",
    );
  }
}

export class AmazonTranscribeSpeechToText implements SpeechToText {
  public readonly providerName = "transcribe";

  async transcribe(
    _audio: Buffer | Uint8Array | string,
    _options?: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    throw new Error(
      "Amazon Transcribe does not natively support Egyptian Arabic dialect (ADR-005). Please use ASR_PROVIDER=fake or ASR_PROVIDER=elevenlabs.",
    );
  }
}
