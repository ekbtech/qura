export type PlatformSettings = {
  schoolName: string;
  contactEmail: string;
  timeZone: string;
  language: "en" | "sw";
  theme: "light" | "dark" | "system";
  emailVerificationEnabled: boolean;
  sessionTimeoutHours: number;
  defaultEventDurationHours: number;
  defaultResultsPublic: boolean;
  defaultPollSessionProtection: boolean;
  defaultPollRateLimit: number;
};

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  schoolName: "QURA",
  contactEmail: "",
  timeZone: "Africa/Nairobi",
  language: "en",
  theme: "light",
  emailVerificationEnabled: false,
  sessionTimeoutHours: 8,
  defaultEventDurationHours: 24,
  defaultResultsPublic: false,
  defaultPollSessionProtection: true,
  defaultPollRateLimit: 10,
};
