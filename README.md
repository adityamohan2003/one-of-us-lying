# One of Us Is Lying

A mobile-first real-time social deduction party game for 3–8 players.

## Run locally

Requirements: Node.js 20+.

```bash
npm install
npm start
```

Open http://localhost:3000 on the host computer.

For phones on the same Wi-Fi, use the host computer's LAN IP, e.g.:
`http://192.168.1.20:3000`

## Deploy

This is a standard Node + Express + Socket.IO server. Deploy it to a Node-capable host such as Render, Railway, Fly.io, or a VPS.

Set the start command to:
`npm start`

The server listens on `process.env.PORT`.

## Game rules implemented

- 3–8 players
- One completely clueless Impostor per round
- Everyone else receives the same topic
- Spoken answers
- 60-second discussion
- Secret voting
- +2 for correctly identifying the Impostor
- +3 for an Impostor who survives
- +2 for a caught Impostor who correctly guesses the topic
- 5 rounds
- Host controls round transitions
- Server-authoritative roles and scores

## Important MVP note

The first version intentionally does not record players' spoken answers. The game is designed around face-to-face conversation while phones handle private information, timers, voting and scoring.
