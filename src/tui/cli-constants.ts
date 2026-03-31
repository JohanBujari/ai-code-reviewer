import type { SelectItem } from "./components/select-input";

export const PR_URL_REGEX =
  /https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/;

export const MENU_ITEMS: SelectItem[] = [
  {
    label: "Watch repositories",
    value: "watch",
    icon: "\u25b6",
    description: "Monitor repos for new PRs",
  },
  {
    label: "Review a PR",
    value: "review",
    icon: "\u2691",
    description: "Paste an Azure DevOps PR URL",
  },
  {
    label: "Manage profiles",
    value: "manage-profile",
    icon: "\u2630",
    description: "Edit or delete profiles",
  },
  {
    label: "Setup guide",
    value: "setup-guide",
    icon: "\u2139",
    description: "How to configure Azure DevOps",
  },
  { label: "Exit", value: "exit", icon: "\u2715", description: "" },
];

export type Phase =
  | "menu"
  | "profile-select"
  | "profile-name"
  | "manage-profile"
  | "manage-profile-action"
  | "setup-guide"
  | "config"
  | "provider-check"
  | "review-url"
  | "reviewing"
  | "review-done"
  | "review-error"
  | "launching-watch";
