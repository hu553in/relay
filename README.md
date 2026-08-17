# Relay

> Hear. Relay. Understand.

[![CI](https://github.com/hu553in/relay/actions/workflows/ci.yml/badge.svg)](https://github.com/hu553in/relay/actions/workflows/ci.yml)

Desktop app for live speech transcription and translated captions through the OpenAI Realtime API.

## What it does

- Captures microphone audio, system audio, or both through browser media APIs
- Streams PCM16 audio chunks from the renderer to an OpenAI Realtime WebSocket session
- Lets the control window start and stop Relay, choose sources, set the original caption label and
  target translation language, manage the API key, toggle the overlay, and export transcripts
- Shows recent original and translated captions in the overlay window
- Saves transcripts as plain text with source and target language codes

## Requirements

- Bun
- OpenAI API key with Realtime API access
- Desktop runtime supported by Electron

## Setup

```bash
bun i
bun dev
```

Open the control window, save an OpenAI API key, choose the original caption label and target
translation language, then start Relay.

## Configuration

Relay stores app settings locally. Defaults:

| Name                  | Default | Description                          |
| --------------------- | ------- | ------------------------------------ |
| `microphone`          | `true`  | Capture microphone audio             |
| `systemAudio`         | `true`  | Capture system audio                 |
| `originalLanguage`    | `en`    | Original transcript label, or `auto` |
| `translationLanguage` | `ru`    | Target translation language          |
| `overlayRows`         | `4`     | Captions shown in the overlay        |
| `overlayOpacity`      | `0.8`   | Overlay window opacity               |

The OpenAI API key is stored separately from normal app settings.

## Runtime behavior

- The renderer captures audio with Web Audio APIs and sends fixed-size PCM16 chunks through IPC
- The Electron main process owns the Realtime WebSocket session and app state
- System audio capture uses `getDisplayMedia` and requires platform support for shared audio
- Captions are kept in app state, rendered in the overlay, and exported through the save dialog
- Settings cannot be edited while Relay is actively connecting or listening

## Development

```bash
bun check
bun check:fix
bun check:types
bun check:build
bun check:unused
bun check:vulns
```

## Build

```bash
bun run build
```

`bun run build` writes packaged Electron artifacts to `release/<version>/`.

## Release

Versioning is handled through `release-it`:

```bash
bun release:patch
bun release:minor
bun release:major
```

The release config runs the full check, commits the next `package.json` version, and pushes a
matching `vX.Y.Z` tag. It does not publish npm packages or create the GitHub release directly.

Release builds run from Git tags matching `v*.*.*`. The CI workflow builds Linux, macOS, and Windows
artifacts and publishes them to the GitHub release.

Release builds are unsigned unless signing credentials are configured outside this repository.

## Tech stack

- Electron, React, TypeScript, Bun
- Vite, Tailwind CSS, Base UI, lucide-react
- ESLint, Prettier, Stylelint, Lefthook, Knip
