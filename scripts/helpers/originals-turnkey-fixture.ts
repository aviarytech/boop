// Joins PR b's author DID (scripts/helpers/author-did-fixture.ts) to PR e's
// list Originals (scripts/helpers/originals-v5-fixture.ts). TURNKEY IS MOCKED
// by local Ed25519 keys; the host judges with convex/lib/originalsSubmission.ts.
export { mockTurnkey, mintAuthor, shared } from "./author-did-fixture";
export { originals, makeHost, judgeSubmission } from "./originals-v5-fixture";
