# Custom emoji reactions

The reaction picker uses the same lazy runtime-configured emoji catalog as the composer, including image entries and their names, IDs and aliases. This does not discover new Matrix room/account image packs.

Unicode uses its existing [`m.reaction` / `m.annotation` string key](https://matrix-org.github.io/matrix-js-sdk/interfaces/types.ReactionEventContent.html). Selecting an image uploads the configured public artwork through the existing bounded, credential-free image download and Matrix upload path, then uses its `mxc://` URI as the annotation key. Existing MXC artwork can be reused without another upload. Permission and account/room identity are checked again after upload. Removing your reaction redacts its original event with the unchanged MXC key.

MXC keys are a custom-image convention carried by the standard reaction event; clients without image-reaction rendering may show the URI. Aimtrix adds optional `dev.alucard.aimtrix.reaction.v1: { "name": "Display name" }` content solely for a bounded accessible label after reload. Other clients can ignore this field. No image bytes, inline HTML or credentials appear in this extension. Unicode events are unchanged. Like existing Matrix reactions, image reactions are annotations, not plaintext replacement messages in encrypted rooms. Configured artwork is public media, as it is for inline custom emoji; private encrypted attachment bytes are not repurposed for reactions.

Incoming MXC images use the authenticated media resolver. Arbitrary HTTPS reaction keys remain text and cannot trigger remote image requests. Data saver or disabled media autoplay displays the retained label without fetching reaction artwork. Missing labels fall back to “Custom emoji”; unavailable media keeps a readable label.

Unit tests cover catalog selection, Matrix payloads, post-upload permission checks, received labels, authenticated rendering, removal and media preferences. Browser coverage exercises custom pack search and selection on desktop/mobile demo fixtures. Independent-client image rendering remains an interoperability check; no live homeserver interoperability is claimed by these mocked tests.
