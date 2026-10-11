#!/usr/bin/env python3
"""Fixed local adapter. No model-name resolution, URLs, tool calls or downloads."""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys
import wave

PINS = {
    'config.json': 'a73a28cdfe1c43ccc7202fa333d1f89c202477271407ae9a7f19afa52039cac8',
    'model.bin': 'dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1',
    'tokenizer.json': 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab',
    'vocabulary.txt': '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913',
}
VERSIONS = {'faster-whisper': '1.2.1', 'av': '18.1.0', 'ctranslate2': '4.8.2', 'huggingface_hub': '2.2.0'}

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--model', required=True)
    p.add_argument('--audio')
    p.add_argument('--source-key')
    p.add_argument('--language', default='')
    p.add_argument('--verify', action='store_true')
    args = p.parse_args()
    if sys.version_info[:3] != (3, 14, 7): raise ValueError('version')
    for name, expected in VERSIONS.items():
        if importlib.metadata.version(name) != expected: raise ValueError('version')
    root = Path(args.model)
    if not root.is_absolute() or root.resolve() != root: raise ValueError('model path')
    for name, digest in PINS.items():
        path = root / name
        if path.is_symlink() or not path.is_file(): raise ValueError('model path')
        with path.open('rb') as f:
            if hashlib.file_digest(f, 'sha256').hexdigest() != digest: raise ValueError('model identity')
    if args.verify:
        print(json.dumps({'verified': True})); return
    path = Path(args.audio)
    if path.is_symlink() or not path.is_absolute() or not path.is_file(): raise ValueError('audio path')
    with wave.open(str(path), 'rb') as f:
        duration = f.getnframes() / f.getframerate()
        if not 0 < duration <= 600 or f.getnchannels() != 1 or f.getframerate() != 16000: raise ValueError('audio bounds')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    from faster_whisper import WhisperModel
    model = WhisperModel(str(root), device='cpu', compute_type='int8', local_files_only=True, cpu_threads=4, num_workers=1)
    iterator, info = model.transcribe(str(path), beam_size=5, vad_filter=False, language=args.language or None)
    segments = []
    last = 0
    scalars = 0
    for segment in iterator:
        start, end = round(segment.start * 1000), round(segment.end * 1000)
        text = segment.text.strip()
        if not text: continue
        if not math.isfinite(segment.start) or not math.isfinite(segment.end) or start < last or end < start or end > math.ceil(duration * 1000): raise ValueError('timestamps')
        last = end
        scalars += len(text)
        if len(segments) >= 2000 or scalars > 20000: raise ValueError('output bounds')
        segments.append({'startMs': start, 'endMs': end, 'text': text, 'sourceKey': args.source_key})
    output = json.dumps({'language': info.language, 'segments': segments}, ensure_ascii=False, separators=(',', ':'))
    if len(output.encode('utf-8')) > 65536 or len(output) > 20000: raise ValueError('output bounds')
    print(output)

if __name__ == '__main__':
    try: main()
    except Exception:
        # Never serialize provider exceptions, paths, private audio or prose.
        sys.exit(2)
