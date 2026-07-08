import assert from "node:assert/strict";
import { planChanges, planPullChanges } from "../dist/sync-core.js";
import {
  detectRemotePrefix,
  remoteBasePrefix,
  remotePath,
} from "../dist/remote-paths.js";

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

assert.deepEqual(
  planPullChanges({}, { "a.md": { sha: "R1" } }, { "a.md": { sha: "R1", remoteSha: "R1" } }),
  [{ type: "download", path: "a.md", remoteSha: "R1" }],
);
assert.deepEqual(
  planPullChanges(
    { "a.md": { sha: "R1", remoteSha: "R1" } },
    {},
    { "a.md": { sha: "R1", remoteSha: "R1" } },
  ),
  [{ type: "deleteLocal", path: "a.md" }],
);
assert.deepEqual(
  planPullChanges(
    { "a.md": { sha: "L2", remoteSha: "R1" } },
    {},
    { "a.md": { sha: "R1", remoteSha: "R1" } },
  ),
  [],
);

assert.equal(remoteBasePrefix("Personal ", ""), "Personal");
assert.equal(remoteBasePrefix(" Personal\u200b ", " Notes / Mobile "), "Personal/Notes/Mobile");
assert.equal(remotePath("Personal ", "", "Oi.md"), "Personal/Oi.md");
assert.equal(
  detectRemotePrefix("Personal ", "", [
    "Personal /Oi.md",
    "Personal/Procedural Map Generation.md",
  ]),
  "Personal",
);
console.log("sync-core tests passed");
