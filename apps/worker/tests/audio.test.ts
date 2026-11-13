import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planChunks, prepareAudioForAsr } from "../src/audio.js";

const log = { warn: () => undefined, info: () => undefined };

describe("planChunks (ADR-024)", () => {
  it("cuts ~N-second chunks, each after the first starting `overlap` seconds early", () => {
    expect(planChunks(50, 20, 2)).toEqual([
      { start: 0, end: 20, leadIn: 0 },
      { start: 20, end: 40, leadIn: 2 },
      { start: 40, end: 50, leadIn: 2 },
    ]);
  });

  it("folds a sub-second tail into the last chunk instead of sending a sliver", () => {
    expect(planChunks(40.4, 20, 2)).toEqual([
      { start: 0, end: 20, leadIn: 0 },
      { start: 20, end: 40.4, leadIn: 2 },
    ]);
  });

  it("works without overlap", () => {
    expect(planChunks(30, 20, 0).map((c) => c.leadIn)).toEqual([0, 0]);
  });
});

describe("prepareAudioForAsr", () => {
  it("falls back to the original file when ffmpeg is missing", async () => {
    const prepared = await prepareAudioForAsr("/some/recording.mp3", {
      chunkSeconds: 20,
      log,
      ffmpegPath: "definitely-not-ffmpeg-binary",
    });
    expect(prepared.path).toBe("/some/recording.mp3");
    expect(prepared.chunks).toBeUndefined();
    await prepared.cleanup();
  });

  const hasFfmpeg =
    spawnSync("ffmpeg", ["-version"]).status === 0 &&
    spawnSync("ffprobe", ["-version"]).status === 0;

  it.skipIf(!hasFfmpeg)(
    "writes overlapping chunk files to disk and removes them on cleanup",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "audio-test-"));
      try {
        const input = join(dir, "tone.mp3");
        spawnSync("ffmpeg", [
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=45",
          input,
        ]);

        const prepared = await prepareAudioForAsr(input, {
          chunkSeconds: 20,
          overlapSeconds: 2,
          log,
        });

        expect(prepared.durationSeconds).toBeCloseTo(45, 0);
        expect(prepared.chunks?.map((c) => [c.startMs, c.leadInMs])).toEqual([
          [0, 0],
          [20_000, 2_000],
          [40_000, 2_000],
        ]);
        for (const chunk of prepared.chunks ?? []) {
          expect(chunk.buffer).toBeUndefined();
          expect(existsSync(chunk.path!)).toBe(true);
        }

        await prepared.cleanup();
        expect(existsSync(prepared.chunks![0]!.path!)).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
