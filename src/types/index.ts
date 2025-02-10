export type EmailSource = {
  link: string;
  email: string;
  timestamp: string;
};

export type Result = {
  domain: string;
  emailsWithSources: EmailSource[];
  error?: string;
};

export type TableUpdates = {
  status?: string;
  subLinks?: string;
  progress?: string;
  emailsFound?: string;
  lastUpdate?: string;
};
