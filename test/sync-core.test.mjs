import assert from "node:assert/strict";
import { planChanges } from "../dist/sync-core.js";

const base = { "a.md": { sha: "L1", remoteSha: "R1" } };
assert.deepEqual(
  planChanges({ "a.md": { sha: "L2", remoteSha: "R1" } }, { "a.md": { sha: "R1" } }, base),
  [{ type: "upload", path: "a.md" }],
);
assert.deepEqual(
  planChanges({ "a.md": { sha: "L1", remoteSha: "R1" } }, { "a.md": { sha: "R2" } }, base),
  [{ type: "download", path: "a.md", remoteSha: "R2" }],
);
assert.equal(
  planChanges({ "a.md": { sha: "L2", remoteSha: "R1" } }, { "a.md": { sha: "R2" } }, base)[0].kind,
  "both_modified",
);
assert.equal(
  planChanges({ "a.md": { sha: "L2", remoteSha: "R1" } }, {}, base)[0].kind,
  "local_modified_remote_deleted",
);
assert.equal(
  planChanges({}, { "a.md": { sha: "R2" } }, base)[0].kind,
  "local_deleted_remote_modified",
);
assert.equal(
  planChanges({ "new.md": { sha: "L", remoteSha: null } }, { "new.md": { sha: "R" } }, {})[0].kind,
  "both_added",
);
console.log("sync-core tests passed");
