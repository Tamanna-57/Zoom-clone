# Zoomeet — frontend

Next.js 16 (App Router, TypeScript) + Tailwind CSS v4 client for Zoomeet.

```bash
npm install
cp .env.example .env.local     # NEXT_PUBLIC_API_URL points at the FastAPI backend
npm run dev                    # http://localhost:3000
```

The backend must be running first — see the [root README](../README.md) for the full
setup, architecture, database schema and API reference.

## Layout

| Path | What lives there |
| --- | --- |
| `src/app/(app)/` | Signed-in shell: home, meetings, contacts, AI notes, settings |
| `src/app/meeting/[code]/` | The in-call experience (pre-join + WebRTC room) |
| `src/app/shared/[token]/` | Public read-only recap |
| `src/lib/api.ts` | The only module that talks HTTP |
| `src/lib/useMeetingRoom.ts` | WebRTC mesh + meeting WebSocket |
| `src/lib/speech.ts` | Web Speech API transcription |
| `src/components/ui/` | Buttons, modals, avatars, the icon set |
| `src/components/meeting/` | Video tiles, toolbar, chat, participants, AI notes |
| `src/components/recap/` | The recap view, shared by the private and public pages |

## Scripts

```bash
npm run dev      # development server
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint
```
