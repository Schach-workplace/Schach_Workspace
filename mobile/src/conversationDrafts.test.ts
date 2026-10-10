import { it, expect } from "vitest";
import * as implementation from "./conversationDrafts";
import { registerDraftCases } from "../../shared/communication/drafts.cases";
registerDraftCases(it, expect, implementation);
