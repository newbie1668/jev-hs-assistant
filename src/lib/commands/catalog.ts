export const COMMAND_CATALOG = {
  suggest_hs:
    "Suggest an HS6 code for the current shipping document text using hierarchical classification.",
  assign_hs_draft:
    "Apply the current suggestion as a human-confirmed draft assignment (writable draft only).",
  request_human_review:
    "Send the shipment / suggestion to a human reviewer without assigning.",
  open_shipment:
    "Open or focus the current shipment workspace in the dashboard.",
  prepare_declaration_draft:
    "Prepare a local declaration draft from assigned HS codes — never files with customs.",
  submit_declaration:
    "CRITICAL: file a customs declaration. Blocked in this MVP — requires out-of-band human filing.",
} as const;

export type CommandId = keyof typeof COMMAND_CATALOG;

export const EXECUTABLE_COMMANDS: CommandId[] = [
  "suggest_hs",
  "assign_hs_draft",
  "request_human_review",
  "open_shipment",
  "prepare_declaration_draft",
];

export function isCommandId(value: string): value is CommandId {
  return value in COMMAND_CATALOG;
}

export interface CommandOutcome {
  command: CommandId;
  confidence: number;
  allowed: boolean;
  blockedReason?: string;
  message: string;
  requiresHumanConfirm: boolean;
}

export function gateCommand(
  command: CommandId,
  confidence: number,
): CommandOutcome {
  switch (command) {
    case "suggest_hs":
      return {
        command,
        confidence,
        allowed: confidence >= 0.35,
        message:
          confidence >= 0.35
            ? "Ready to run hierarchical HS suggestion."
            : "Low confidence on command intent — clarify or click Suggest HS.",
        requiresHumanConfirm: false,
        blockedReason:
          confidence >= 0.35 ? undefined : "confidence_below_threshold",
      };
    case "assign_hs_draft":
      return {
        command,
        confidence,
        allowed: true,
        message: "Assignment requires explicit human confirm in the UI.",
        requiresHumanConfirm: true,
      };
    case "request_human_review":
      return {
        command,
        confidence,
        allowed: true,
        message: "Review request is always allowed.",
        requiresHumanConfirm: false,
      };
    case "open_shipment":
      return {
        command,
        confidence,
        allowed: confidence >= 0.4,
        message: "Open current shipment workspace.",
        requiresHumanConfirm: false,
        blockedReason:
          confidence >= 0.4 ? undefined : "confidence_below_threshold",
      };
    case "prepare_declaration_draft":
      return {
        command,
        confidence,
        allowed: confidence >= 0.7,
        message:
          "Can prepare a local draft only after an assigned HS6 exists. Never auto-files.",
        requiresHumanConfirm: true,
        blockedReason:
          confidence >= 0.7 ? undefined : "confidence_below_threshold",
      };
    case "submit_declaration":
      return {
        command,
        confidence,
        allowed: false,
        blockedReason: "submit_out_of_scope",
        message:
          "Auto-submit is disabled. Classification confidence is never permission to file.",
        requiresHumanConfirm: true,
      };
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}
