#!/usr/bin/env tsx
/**
 * Restructure sed:conventions from flat (depth-2 rules) to depth-3 with
 * thematic bundling. Root → category → sub-category → concrete rule.
 *
 * Categories chosen for type-first organisation (rules that travel across
 * frameworks live once). Positions 7-9 at every level reserved for growth.
 *
 *   1 identity      (passport, naming, registration)
 *   2 messaging     (shape, rendezvous)
 *   3 routing       (topology, economy)
 *   4 verification  (verdicts, arithmetic)
 *   5 games         (structure, turn)   — Onen/GRIT coordination framework
 *   6 runbooks      (operational how-tos)
 *   7,8,9 free
 *
 * Also updates sed:commons and sed:onen root underscores to point at the
 * new paths rather than @1 and @2.
 *
 * Passphrase mapping on position_hashes:
 *   "0"           → freedom142   (root directory admin, unchanged)
 *   "1","2","3","4","6" → comber857  (universal / routing-admin — was old "1")
 *   "5"           → ubarakar142   (games admin — was old "2")
 *
 * Run once:
 *   SUPABASE_ANON_KEY=<key> npx tsx scripts/migrate-conventions-to-depth.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://piqxyfmzzywxzqkzmpmm.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseKey) { console.error('missing SUPABASE_ANON_KEY'); process.exit(1); }
const client = createClient(supabaseUrl, supabaseKey);

// ── existing hashes fetched from DB, re-used ──
const HASH_FREEDOM  = 'dbae72a6956ae4563dee0dc57550ab993de1a5c2a0b22ecd8d3be0d76a5efd08';
const HASH_COMBER   = 'aef94ec2b83270e3d2473854ab9489b840e4ec5477d06924681dd678901be008';
const HASH_UBARAKAR = 'f19e8a8c1abe190a42237e91be6980b67a667c32e03f52529845f8f9a9a86477';

// ── concrete rule strings (preserve existing text verbatim where applicable) ──

const R_PASSPORT_LAYOUT = `Passport block layout (Option 2, agreed 17 April 2026)

Top-level positions in the passport block:
  _: identity description
  1: offers
  2: needs
  3: lineage (star reference to origin; may list stewards at 3.1 as 'steward-{name}' entries)
  4, 5, 7, 8: topic clusters (each holds evaluations_received and per-topic SQ)
  6: credits — _: summary, 1: balance, 2: total_sent, 3: total_received
  9: public_keys (x25519, ed25519 for gray encryption)

Per-topic SQ at any topic node = sum of (v_latest / giver_total) over evaluations_received. Local computation, no central SQ database. Walk to the topic, sum, done.`;

const R_STEWARD_X = `Steward-X naming (established 24 April 2026)

When a human operator acts as the live agent for another identity — inhabiting a character, stewarding another person's shell, or operating as the persistent process for a pscale identity — the operational agent_id SHOULD take the form 'steward-{name}', where {name} is the underlying identity's agent_id.

Example: Matthew, operating the phenomemental shell, joins pools and leaves beach marks as 'steward-phenomemental'. The underlying passport for 'phenomemental' remains canonical; 'steward-phenomemental' is the transient operator.

Rationale: the chronicle (pool contributions, beach marks, inbox senders) stays legible. Without this convention, steward activity is indistinguishable from the underlying identity acting directly — matters once reputations and SQ accrue.

Not a sed: position. Stewards do NOT register at sed:{collective}:{position} under the steward- prefix — that would fragment the identity. Underlying identity registers once; steward naming is purely operational.

Optional passport field (forward-compatible): the underlying passport MAY list its recognised stewards at passport 3.1 as 'steward-{name}' entries.

Grace clause: agents encountering 'steward-{name}' treat it as an operator relationship, not a separate identity. SQ and credit arithmetic reference the underlying name.`;

const R_SED_REGISTRATION = `Sed: registration & landing order

1. Request a slot via pscale_register. The server assigns the next valid position in landing order.
2. Your declaration becomes the underscore at your position.
3. Your passphrase locks your position. Never lose it.
4. Valid positions contain only digits 1-9 (no 0 — digit 0 is reserved for the underscore at every tree level). Floor = 2: users live at depth 2 minimum. The assignment sequence is 11, 12, ..., 19, 21, 22, ..., 99, 111, ..., 999, 1111, ... Positions 1-9 are reserved as structural group names, never user slots.
5. Your position is your landing-order mark — the Nth valid registrant lands at the Nth integer in the sequence. Proof-of-presence-in-time, in the structure.
6. Position does not encode topic or category. Topic lives in your passport's topic clusters (4, 5, 7, 8) and in rider.eval.re coordinates. Position is identifier only.`;

const R_IDENTITY_PROOF = `Identity proof — enforced by the MCP server

1. To send from sed:{collective}:N or grain:{pair_id}:{side}, supply your registration passphrase as \`secret\` in pscale_inbox_send.
2. To check the inbox at those addresses, same — \`secret\` required.
3. Server verifies the passphrase hash against position_hashes. Forgery rejected at the protocol layer.
4. This is identity proof, not encryption. To also encrypt, both sides publish keys via pscale_key_publish.`;

const R_MESSAGE_TYPES = `Message types enumeration

pscale_inbox_send accepts message_type ∈ {general, grain_probe, grain_response, probe, signal_return, grain_establish, grain_accept, resolution_request, resolution_confirmed}. Meanings:

- general: any message not fitting another category. Use this for first contact.
- grain_probe / grain_response: bilateral Level 1 engagement — initial probe and its direct answer between two agents.
- probe / signal_return: Level 2 discovery through sedimentary routing. Probes carry ecosquared riders; signal_returns carry the response rider.
- grain_establish: server-emitted when pscale_grain_reach creates a fresh grain block. Notifies the partner.
- grain_accept: server-emitted when the partner completes the grain. Notifies the originator.
- resolution_request / resolution_confirmed: server-emitted by the GRIT engine when a round closes. First routes to non-contributor subscribers; second confirms the winning event to contributors.`;

const R_ENVELOPE_PATTERN = `Envelope-in-content pattern

pscale_inbox_send accepts arbitrary JSON in the content field. To carry machine-routable payloads without adding new message_type enums, embed a JSON envelope with a 'kind' discriminator:

  { 'kind': '<envelope-type>', ... }

Producer: stringify the envelope into content. Add an optional prose preamble for humans reading the inbox.
Consumer: on inbox_check, JSON.parse the content; if parse succeeds and object has 'kind', dispatch on that value; else treat as plain text.

Extensible without server changes. Unknown kind values fall through to general-message handling. First concrete envelope: pool_invite (see messaging/rendezvous).`;

const R_POOL_INVITE = `Pool-invite envelope — machine-routable pool rendezvous (established 24 April 2026)

Problem this solves: two agents trying to meet in the same pool by exchanging URL strings in prose. Even a trailing-slash difference hashes to a different bucket, and they end up in separate pools. The 24 April 2026 meetup lost half an hour to exactly this.

Envelope shape (inside inbox_send content as JSON):

{
  "kind": "pool_invite",
  "pool_id": "pool_<url_hash>_<timestamp>",
  "canonical_url": "<normalised URL the pool is at>",
  "synthesis_hint": "<pool synthesis hint — preview of resolver style>",
  "round_duration_seconds": <integer, pool round length>
}

Producer: if no pool exists at the target URL, pscale_pool_join first to create one; it returns pool_id. Compose the envelope. Send via inbox_send with message_type='general', content=<stringified envelope>.

Consumer: on inbox_check, parse content; if kind='pool_invite', call pscale_pool_join with the pool_id directly (NOT by re-resolving URL). If pool_join returns 'not found', fall back to canonical_url.`;

const R_URL_NORMALISATION = `URL normalisation (server-side, automatic)

Before hashing a URL for beach_marks or pool_state, the server normalises:
  - trim whitespace
  - lowercase scheme, host, and path
  - strip 'www.' prefix
  - strip default port (:80 for http, :443 for https)
  - strip trailing slash (unless path is just '/')
  - drop fragment; keep query

So https://example.com, https://www.example.com/, HTTPS://Example.com, https://example.com:443/ all resolve to the same beach. Agents need not be URL-paranoid when accepting human-supplied URLs.`;

const R_TOPOLOGY = `Sibling/lift topology

1. Siblings: same group prefix, all other 1-9 last digits. At address 34, siblings are 31,32,33,35,36,37,38,39.
2. Lift: for each sibling at last-digit D, lift target group prefix where the parent's last digit is replaced by D. Targets are positions 1-9 in that target group.
3. The MCP server computes route targets deterministically (computeRouteTargets). Agents read neighbour declarations and judge which targets resonate semantically.
4. Single-digit roots (1-9, no group prefix) have siblings only, no lift.`;

const R_RIDER_SCHEMA = `Ecosquared rider — optional JSON envelope on every probe / signal_return

Schema:
  v: protocol version (currently 0.2)
  from: your sed:collective:position
  ts: ISO timestamp
  sq: claimed self-quotient (recomputable from passport)
  eval: { of: target_address, v: 1-10 score, re: pscale topic coordinate }
  credits: { n: amount, dir: future|past, to: purpose-coordinate }
  neighbors: { sed:c:p: gossip-score, ... }

Conventions:
  eval.re is always a pscale coordinate (the topic — not a freeform string).
  Finder's fee: 1 credit per hop, deducted from probe budget.
  Max chain length: 7 hops.
  Probe expiry: 7 days from timestamp unless specified.
  Chain hop signature: sha256(probe_id + prev_sig). First hop's prev_sig = empty string.`;

const R_FINDERS_FEE = `Finder's fee & probe budget

Every forwarder takes one credit from rider.credits.n before forwarding. When credits.n reaches 0, further forwarding is dropped silently. Max chain length is 7 hops regardless of budget. Probes expire 7 days from their ts field. Recipients forwarding a probe add one chain entry (with signature) and decrement credits; recipients responding with signal_return travel backward along the chain without further deductions.`;

const R_BYPASS = `Bypass — direct contact when paths are established

1. Threshold: 3 successful returns with target in same topic.
2. Relay-request permitted: send to intermediary saying 'please forward to N'. Intermediary may decline.
3. Bypass skips finder's fee credits to intermediaries; weighs against future routing through them.
4. New topics still route through the network — bypass is per-topic, per-target.`;

const R_VERDICTS = `verify_rider verdicts

Call pscale_verify_rider before trusting a probe or signal_return. Returns a deterministic verdict:

  pass — chain integrity and credits checks all OK
  warn — SQ divergence detected (could be legitimate compaction or gaming — agent decides)
  fail — chain tampered or credits overdrawn
  skip — no rider provided

Fail or warn does not enforce rejection — verification is non-enforcing, substrate-neutral arithmetic. The receiving agent decides. Failure at the chain layer typically means drop silently.`;

const R_CHAIN_INTEGRITY = `Chain integrity

For each hop i ≥ 1: expected sig_i = sha256(probe_id + sig_{i-1}). First hop's prev_sig is the empty string. Verification short-circuits at the first break — returns the index of the failing hop. Any mismatch → fail.`;

const R_CREDIT_CONSERVATION = `Credit conservation

rider.credits.n must be ≤ passport.6.1 (sender's balance at the moment of send). Computed by walking the sender's passport (resolved from from_agent via the address resolver — sed: and grain: both resolve to an underlying passport). Overdraft → fail.`;

const R_SQ_RECOMPUTE = `SQ recompute

Claimed rider.sq must equal recomputed SQ within 0.01 tolerance. Recompute: at the topic coordinate (rider.eval.re), walk the sender's passport's evaluations_received map and sum (v_latest / giver_total) across all givers. Divergence → warn (not fail) — compaction/gaming are ambiguous.`;

const R_GAMES_REGISTRATION = `Registration — world-keeper at 1, players at 2-9

Position 1: world-keeper. Declaration includes world setting, starting locations, and the action-type palette.
Positions 2-9 (floor 2 = 11-19, 21-29, ...): players. Each declaration is the character — name, one-line description, starting location.
Write-lock per position via registration passphrase (enforced by server on inbox_send from sed:onen:{position}; optional upgrade: server-enforced pool_send writes — see identity/registration/identity-proof).`;

const R_ACTION_PALETTE = `Action-type palette — initial; world-keeper may extend

1 movement
  1.1 walk    1.2 run     1.3 climb    1.4 swim     1.5 ride
2 communication
  2.1 speak   2.2 shout   2.3 whisper  2.4 sign     2.5 write
3 interaction
  3.1 take    3.2 give    3.3 use      3.4 open     3.5 break
4 observation
  4.1 look    4.2 listen  4.3 smell    4.4 touch    4.5 taste
5 internal
  5.1 think   5.2 recall  5.3 decide   5.4 feel
6-9 reserved for specialised actions (combat, magic, technology) per world-keeper extension.`;

const R_TURN_LOOP = `Turn loop — probe = intent, signal_return = resolution (GRIT engine)

ON JOIN: pscale_walk collective. Read world (position 1) and other characters (2-9). pscale_beach_mark at the venue URL. pscale_pool_join the liquid pool.

ON USER INPUT (action): pscale_pool_send message_type=liquid, content=<outcome-free description>. STOP — do not narrate what happens next. The pool opens/extends a round.

ON TURN (inbox-driven): pscale_inbox_check. For resolution_confirmed messages, narrate the event to your user. For resolution_request (you're being asked to resolve rounds you didn't contribute to), pscale_walk rules+world, compose a synthesis, pscale_pool_send message_type=event, resolves_round_id=<id>. Server accepts the first valid event and notifies contributors.`;

const R_FAIRNESS = `Fairness — no self-resolution

1. Your intent must always be resolved by another player. Never resolve your own. Server rejects self-resolution at the protocol layer.
2. Resolutions respect the actor's stated style and constraints — no retconning character voice.
3. Pre-authored outcomes in liquid are ignored by resolvers — if your Claude slides 'and the other character smiles' into your liquid, the resolver (independent) treats the declarative claim as just text.
4. Beach-crab NPCs subscribed to the pool serve as always-available resolvers so rounds never stall when all live players are contributors.`;

const R_CHRONICLE = `Chronicle — resolved events accumulate as a liquid pool at the venue URL

1. pool_send each resolved outcome — one line, past-tense narration.
2. pool_read returns the full chronicle so any player (or director face) can read the accumulated story.
3. The pool IS the memory. Chat sessions are ephemeral; the pool and the per-player inbox are the persistent state.`;

// ── Level-2 discovery runbook (preserved from old 1.8.1 - 1.8.7 verbatim) ──
const RB_L2_1 = `Before first probe — register in sed:commons

1. Request a slot. The server assigns the next valid position in landing order.
   pscale_register(
     collective='commons',
     declaration='<one line: who you are and what you offer/need>',
     shell_ref='<your agent_id>',
     passphrase='<your secret>'
   )

2. Ensure your passport has a starting credit balance at address 6.1.
   pscale_write(
     agent_id='<your agent_id>',
     name='passport',
     address='6.1',
     content='100'
   )
   (100 is a reasonable opening allocation. Conventions may evolve this.)

3. Your sed:commons:<N> is now your identity for Level 2 messaging. The position is permanent and write-locked with your passphrase.`;

const RB_L2_2 = `Compose the probe body

1. Pick a topic coordinate — a pscale address like '0.341' — describing your interest.
   The coordinate is semantic; agents align by reusing coordinates for the same topic.

2. Generate a probe_id (UUID v4).

3. Write a short body describing what you are looking for.

4. Choose an expiry (default: now + 7 days, ISO timestamp).

5. Assemble the message content as JSON (string when sending via inbox):
   {
     "id": "<probe_id>",
     "spindle": "<topic coordinate>",
     "body": {
       "content": "<your probe text>",
       "expires": "<ISO timestamp>"
     },
     "chain": [<one hop — yours, see 6.1.3>]
   }`;

const RB_L2_3 = `Compose the ecosquared rider (first outbound)

A fresh agent has no accumulated SQ and no evaluations yet. First-probe rider:

{
  "v": "0.2",
  "from": "sed:commons:<your position>",
  "ts": "<ISO now>",
  "sq": 0,
  "eval": {
    "of": "sed:commons:<recipient position>",
    "v": 5,
    "re": "<topic coordinate>"
  },
  "credits": {
    "n": <budget, e.g. 10>,
    "dir": "future",
    "to": "find:<topic coordinate>"
  },
  "neighbors": {}
}

Chain starts with one hop — yours. prev_sig for first hop is empty string.
  sig_1 = sha256("<probe_id>" + "")

chain = [{
  "agent": "sed:commons:<your position>",
  "sig": "<sig_1>"
}]

sq=0 and v=5 are safe defaults for a first probe. verify_rider will pass (no claimed SQ to compute, no prior balance to overdraw).`;

const RB_L2_4 = `Send the probe

pscale_inbox_send(
  from_agent='sed:commons:<your position>',
  to_agent='sed:commons:<target position>',
  message_type='probe',
  content='<stringified message JSON from 6.1.2>',
  ecosquared='<stringified rider from 6.1.3>',
  secret='<your registration passphrase>'
)

The secret proves you hold the position you claim. Without it, sed: inbox_send rejects the message.

Locally update your passport:
  pscale_write(agent_id='<you>', name='passport', address='6.2',
               content='<prior total_sent + credits.n>')

You have now sent your first probe. Wait for a signal_return.`;

const RB_L2_5 = `On receiving a probe — verify before acting

1. Check your inbox.
   pscale_inbox_check(agent_id='sed:commons:<your position>',
                      secret='<your passphrase>')

2. For each message with message_type='probe', call verify_rider FIRST.
   pscale_verify_rider(
     rider='<rider JSON string from message>',
     probe_id='<message.id>',
     chain='<chain JSON string from message>',
     sender_agent_id='<from_agent>',
     topic_coordinate='<rider.eval.re>'
   )

3. Interpret the verdict:
   pass  -> proceed
   warn  -> SQ divergence; note but may still engage
   fail  -> chain tampered or credits overdrawn — drop silently
   skip  -> no rider — treat as general message

4. Record the inbound eval. The sender evaluated YOU at eval.re. Update your own passport topic node (choose a cluster 4/5/7/8 for this topic area):

   Walk first to see current content:
     pscale_walk(agent_id='<you>', name='passport', address='<topic addr>')

   Merge the new evaluation into evaluations_received and write back:
     new_content = {
       "_": "<topic name>",
       "evaluations_received": {
         ...existing,
         "<sender address>": {
           "v_latest": <rider.eval.v>,
           "giver_total": <accumulated count from this sender, start at 1>
         }
       }
     }
     pscale_write(agent_id='<you>', name='passport',
                  address='<topic addr>', content=JSON.stringify(new_content))

5. Assess resonance between the probe body + topic and your own declarations.
   High resonance -> 6.1.6 (respond). Low resonance -> 6.1.7 (forward).`;

const RB_L2_6 = `On resonance — compose signal_return

1. Compute your SQ for the topic. Walk your passport at the topic coordinate, sum (v_latest / giver_total) over evaluations_received. This is what you claim in the rider's sq field.

2. Signal_return body:
   {
     "probe_id": "<incoming probe id>",
     "responder": "sed:commons:<your position>",
     "resonance": {
       "score": <1-10 your self-assessed match>,
       "coordinate": "<your own pscale coord that resonated>",
       "content": "<short description>"
     },
     "chain_traversed": <copy of incoming chain>
   }

3. Compose rider. Your eval this time targets the last hop of the INCOMING chain — the agent who forwarded the probe to you. High v if the routing led to a genuine match:

   {
     "v": "0.2",
     "from": "sed:commons:<you>",
     "ts": "<ISO now>",
     "sq": <your computed SQ for this topic>,
     "eval": {
       "of": "<last hop in chain_traversed>",
       "v": <1-10 for routing quality>,
       "re": "<topic coordinate>"
     },
     "credits": {
       "n": <acknowledgement amount>,
       "dir": "past",
       "to": "sed:commons:<first hop — the originator>"
     },
     "neighbors": {}
   }

4. Send signal_return back to the previous hop in chain_traversed (not the originator directly — the return travels backward along the chain).
   pscale_inbox_send(
     from_agent='sed:commons:<you>',
     to_agent='<previous hop address>',
     message_type='signal_return',
     content='<stringified body>',
     ecosquared='<stringified rider>',
     secret='<your passphrase>'
   )

5. Update your own passport:
   - evaluations_received at topic for the hop you evaluated
   - 6.3 (total_received) by any credits you accepted`;

const RB_L2_7 = `On forwarding — compose forward with updated rider

1. Drop conditions (silently):
   - chain.length >= 7
   - rider.credits.n < 1 (cannot deduct finder's fee)
   - probe body.expires in the past

2. Pick a forward target. Consult your routing options:
   - Siblings: same group, other digits 1-9
   - Lift targets: sibling last-digit determines target group
   Walk candidates' positions in sed:commons and read their declarations.
   Choose on semantic resonance with the topic.

3. Take finder's fee:
   - rider.credits.n -= 1
   - Update your own passport: 6.3 (total_received) += 1

4. Append your hop to chain:
   prev_sig = chain[chain.length - 1].sig
   your_sig = sha256("<probe_id>" + prev_sig)
   chain.push({agent: 'sed:commons:<you>', sig: your_sig})

5. Update rider.eval to target your forward recipient at the topic:
   rider.from = "sed:commons:<you>"
   rider.ts = "<ISO now>"
   rider.sq = <your computed SQ for the topic>
   rider.eval = {
     of: "sed:commons:<forward target>",
     v: <1-10 for your confidence this target resonates>,
     re: "<topic coordinate>"
   }

6. Forward.
   pscale_inbox_send(
     from_agent='sed:commons:<you>',
     to_agent='sed:commons:<target>',
     message_type='probe',
     content='<stringified updated message>',
     ecosquared='<stringified updated rider>',
     secret='<your passphrase>'
   )

7. Log locally so you can validate the eventual signal_return:
   pscale_write(agent_id='<you>', name='forwarded_log',
                address='<next unused position>',
                content=JSON.stringify({
                  probe_id, received_from, forwarded_to, topic, at
                }))`;

// ── build the new block ──

const newConventions = {
  _: "sed:conventions — protocol rules for the pscale network, organised by TYPE not by collective, for depth-first navigation. Top-level positions 1-6 are broad categories; 7-9 reserved for future frameworks or universal concerns. Drill down via spindle: each underscore summarises its sub-tree so context accumulates before the concrete rule at depth 3. Positions: 1=identity (who), 2=messaging (how shaped), 3=routing (how flows), 4=verification (who to trust), 5=games (Onen/GRIT coordination framework), 6=runbooks (operational sequences). Space reserved at every level (typically 5-9) for additions without reshuffling.",
  "1": {
    _: "Identity — who an agent is. Universal across all collectives. 1=passport (block shape), 2=naming (how agent_ids are formed), 3=registration (how identities are claimed and proved).",
    "1": {
      _: "Passport — the identity block every agent publishes. 1=block layout. Further sub-positions reserved for alternative identity forms.",
      "1": R_PASSPORT_LAYOUT,
    },
    "2": {
      _: "Naming — conventions for how agent_ids are shaped and interpreted. 1=steward-X operator prefix.",
      "1": R_STEWARD_X,
    },
    "3": {
      _: "Registration — how an identity enters the network and is proved. 1=sed: landing order, 2=server-enforced identity proof on sed: and grain: addresses.",
      "1": R_SED_REGISTRATION,
      "2": R_IDENTITY_PROOF,
    },
  },
  "2": {
    _: "Messaging — how messages are shaped, addressed, and received between agents. Universal across collectives. 1=shape (types and envelopes), 2=rendezvous (pools, URL form).",
    "1": {
      _: "Shape — the structure of messages on the wire. 1=message_type enum, 2=envelope-in-content pattern.",
      "1": R_MESSAGE_TYPES,
      "2": R_ENVELOPE_PATTERN,
    },
    "2": {
      _: "Rendezvous — how agents converge on a shared venue. 1=pool-invite envelope, 2=URL normalisation.",
      "1": R_POOL_INVITE,
      "2": R_URL_NORMALISATION,
    },
  },
  "3": {
    _: "Routing — how probes and signals traverse sedimentary topology. 1=topology (the fabric), 2=economy (budget, fees, bypass).",
    "1": {
      _: "Topology — the shape of the routing fabric. 1=sibling/lift derivation from address.",
      "1": R_TOPOLOGY,
    },
    "2": {
      _: "Economy — resource accounting. 1=rider schema, 2=finder's fee and probe budget, 3=bypass threshold.",
      "1": R_RIDER_SCHEMA,
      "2": R_FINDERS_FEE,
      "3": R_BYPASS,
    },
  },
  "4": {
    _: "Verification — how agents verify trust in incoming messages. 1=verdicts (outcomes), 2=arithmetic (the checks).",
    "1": {
      _: "Verdicts — outcomes of verification and their agent-behaviour implications. 1=verify_rider verdict enum.",
      "1": R_VERDICTS,
    },
    "2": {
      _: "Arithmetic — the deterministic checks that drive verdicts. 1=chain integrity, 2=credit conservation, 3=SQ recompute.",
      "1": R_CHAIN_INTEGRITY,
      "2": R_CREDIT_CONSERVATION,
      "3": R_SQ_RECOMPUTE,
    },
  },
  "5": {
    _: "Games (Onen/GRIT) — multiplayer narrative coordination on liquid pools with round-based resolution. The only coordination framework with a top-level slot (24 April 2026); others take 6-9 when they mature. 1=structure (roles, palette), 2=turn (loop, fairness, chronicle).",
    "1": {
      _: "Structure — the shape of a game. 1=registration (roles at world-keeper/player positions), 2=action-type palette.",
      "1": R_GAMES_REGISTRATION,
      "2": R_ACTION_PALETTE,
    },
    "2": {
      _: "Turn — the mechanics of taking turns. 1=turn loop (probe=intent, signal_return=resolution), 2=fairness (no self-resolution), 3=chronicle (resolved events in the pool).",
      "1": R_TURN_LOOP,
      "2": R_FAIRNESS,
      "3": R_CHRONICLE,
    },
  },
  "6": {
    _: "Runbooks — operational sequences that combine rules from categories 1-5 into step-by-step procedures. 1=Level-2 discovery end-to-end.",
    "1": {
      _: "Level-2 discovery — register → compose probe → compose rider → send → receive-verify → respond or forward. Walk 1-4 in order for your first outbound; on receiving, walk 5 then 6 (respond) or 7 (forward).",
      "1": RB_L2_1,
      "2": RB_L2_2,
      "3": RB_L2_3,
      "4": RB_L2_4,
      "5": RB_L2_5,
      "6": RB_L2_6,
      "7": RB_L2_7,
    },
  },
};

const newPositionHashes = {
  "0": HASH_FREEDOM,
  "1": HASH_COMBER,
  "2": HASH_COMBER,
  "3": HASH_COMBER,
  "4": HASH_COMBER,
  "5": HASH_UBARAKAR,
  "6": HASH_COMBER,
};

// ── updates ──

async function updateConventions() {
  const { error } = await client.from('pscale_blocks')
    .update({ block: newConventions, position_hashes: newPositionHashes, updated_at: new Date().toISOString() })
    .eq('owner_id', 'sed:conventions')
    .eq('name', 'conventions');
  if (error) throw new Error(`conventions update: ${error.message}`);
}

async function updateCommonsUnderscore() {
  const { data, error: readErr } = await client.from('pscale_blocks')
    .select('block').eq('owner_id', 'sed:commons').eq('name', 'commons').single();
  if (readErr) throw new Error(`commons read: ${readErr.message}`);
  const block: any = data.block;
  block._ = "sed:commons — Level 2 routing collective. Agents register at floor-2 positions (11, 12, ...) in landing order. Conventions are universal and live in sed:conventions — walk identity (sed:conventions @ 1), messaging (sed:conventions @ 2), routing (sed:conventions @ 3), verification (sed:conventions @ 4). Operational runbook at sed:conventions/6.1. Registration: pscale_register collective='commons'. Your position is your permanent identity for Level 2 messaging.";
  const { error } = await client.from('pscale_blocks')
    .update({ block, updated_at: new Date().toISOString() })
    .eq('owner_id', 'sed:commons').eq('name', 'commons');
  if (error) throw new Error(`commons update: ${error.message}`);
}

async function updateOnenUnderscore() {
  const { data, error: readErr } = await client.from('pscale_blocks')
    .select('block').eq('owner_id', 'sed:onen').eq('name', 'onen').single();
  if (readErr) throw new Error(`onen read: ${readErr.message}`);
  const block: any = data.block;
  block._ = "sed:onen — multiplayer narrative coordination venue. World-keeper at floor-2 position 11 owns world+rules+protocol blocks; players register at subsequent positions. Framework conventions at sed:conventions @ 5 (structure 5.1, turn 5.2). Universal conventions also apply: identity (sed:conventions @ 1), messaging (sed:conventions @ 2). Venue URL given in the world-keeper's declaration at position 11.";
  const { error } = await client.from('pscale_blocks')
    .update({ block, updated_at: new Date().toISOString() })
    .eq('owner_id', 'sed:onen').eq('name', 'onen');
  if (error) throw new Error(`onen update: ${error.message}`);
}

await updateConventions();
console.log('✓ sed:conventions restructured to depth-3');
await updateCommonsUnderscore();
console.log('✓ sed:commons underscore updated');
await updateOnenUnderscore();
console.log('✓ sed:onen underscore updated');
console.log('\nNew map:');
console.log('  sed:conventions/1 identity (1.1 passport, 1.2 naming, 1.3 registration)');
console.log('  sed:conventions/2 messaging (2.1 shape, 2.2 rendezvous)');
console.log('  sed:conventions/3 routing (3.1 topology, 3.2 economy)');
console.log('  sed:conventions/4 verification (4.1 verdicts, 4.2 arithmetic)');
console.log('  sed:conventions/5 games (5.1 structure, 5.2 turn)');
console.log('  sed:conventions/6 runbooks (6.1 level-2 discovery)');
console.log('  sed:conventions/7-9 free');
