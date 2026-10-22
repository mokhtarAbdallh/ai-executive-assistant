import type { GoogleOAuthTokens } from "@dawwen/shared";

export interface CalendarEventItem {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
  htmlLink?: string;
  status: "scheduled" | "summarized" | "processing" | "needs_review";
  meetingId?: string;
  isAiBooked?: boolean;
}

export interface CreateCalendarEventInput {
  title: string;
  start: Date;
  end: Date;
  description?: string;
  attendees?: string[];
  location?: string;
}

export interface CalendarProvider {
  getAuthUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<GoogleOAuthTokens>;
  listEvents(tokens: GoogleOAuthTokens, options: { timeMin: Date; timeMax: Date }): Promise<CalendarEventItem[]>;
  createEvent(tokens: GoogleOAuthTokens, event: CreateCalendarEventInput): Promise<{ id: string; htmlLink: string }>;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export class GoogleCalendarProvider implements CalendarProvider {
  constructor(private readonly config: GoogleOAuthConfig) {}

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
      ].join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<GoogleOAuthTokens> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google token exchange failed: ${err}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiryDate: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scope: data.scope,
      tokenType: data.token_type,
    };
  }

  async listEvents(
    tokens: GoogleOAuthTokens,
    options: { timeMin: Date; timeMax: Date },
  ): Promise<CalendarEventItem[]> {
    const params = new URLSearchParams({
      timeMin: options.timeMin.toISOString(),
      timeMax: options.timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to list Google Calendar events: ${err}`);
    }

    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        location?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        htmlLink?: string;
        attendees?: Array<{ email: string }>;
      }>;
    };

    return (data.items || []).map((item) => ({
      id: item.id,
      title: item.summary || "بدون عنوان",
      start: item.start?.dateTime || item.start?.date || new Date().toISOString(),
      end: item.end?.dateTime || item.end?.date || new Date().toISOString(),
      description: item.description,
      location: item.location,
      attendees: item.attendees?.map((a) => a.email),
      htmlLink: item.htmlLink,
      status: "scheduled",
    }));
  }

  async createEvent(
    tokens: GoogleOAuthTokens,
    event: CreateCalendarEventInput,
  ): Promise<{ id: string; htmlLink: string }> {
    const payload = {
      summary: event.title,
      description: event.description,
      location: event.location,
      start: { dateTime: event.start.toISOString() },
      end: { dateTime: event.end.toISOString() },
      attendees: event.attendees?.map((email) => ({ email })),
    };

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create Google Calendar event: ${err}`);
    }

    const created = (await res.json()) as { id: string; htmlLink: string };
    return {
      id: created.id,
      htmlLink: created.htmlLink,
    };
  }
}

export class FakeCalendarProvider implements CalendarProvider {
  private fakeEvents: CalendarEventItem[] = [];

  constructor() {
    this.seedDefaultEvents();
  }

  private seedDefaultEvents(): void {
    const now = new Date();
    const d1 = new Date(now.getTime() + 1000 * 60 * 60 * 24); // Tomorrow
    d1.setHours(10, 0, 0, 0);
    const d1End = new Date(d1.getTime() + 1000 * 60 * 45); // 45 mins

    const d2 = new Date(now.getTime() + 1000 * 60 * 60 * 48); // Day after tomorrow
    d2.setHours(14, 30, 0, 0);
    const d2End = new Date(d2.getTime() + 1000 * 60 * 60);

    const d3 = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 4); // +4 days
    d3.setHours(11, 0, 0, 0);
    const d3End = new Date(d3.getTime() + 1000 * 60 * 30);

    this.fakeEvents = [
      {
        id: "evt-fake-1",
        title: "مراجعة تصميم الواجهات وسير العمل (UI Sprint Planning)",
        start: d1.toISOString(),
        end: d1End.toISOString(),
        location: "Google Meet",
        attendees: ["ahmed@dawwen.ai", "sarah@dawwen.ai"],
        status: "scheduled",
        htmlLink: "https://calendar.google.com/event?eid=fake1",
      },
      {
        id: "evt-fake-2",
        title: "اجتماع توضيحي مع عميل منصة التجارة الإلكترونية",
        start: d2.toISOString(),
        end: d2End.toISOString(),
        location: "Google Meet",
        attendees: ["client@ecommerce-client.com", "mohamed@dawwen.ai"],
        status: "scheduled",
        htmlLink: "https://calendar.google.com/event?eid=fake2",
      },
      {
        id: "evt-fake-3",
        title: "متابعة أداء الـ Bedrock LLM والـ ElevenLabs ASR",
        start: d3.toISOString(),
        end: d3End.toISOString(),
        location: "Zoom",
        attendees: ["team-lead@dawwen.ai"],
        status: "scheduled",
        htmlLink: "https://calendar.google.com/event?eid=fake3",
      },
    ];
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({ state, redirect_uri: redirectUri, mock: "true" });
    return `/api/calendar/callback?${params.toString()}&code=fake_auth_code_for_demo`;
  }

  async exchangeCode(_code: string, _redirectUri: string): Promise<GoogleOAuthTokens> {
    return {
      accessToken: "fake_google_access_token_demo_mode",
      refreshToken: "fake_google_refresh_token_demo_mode",
      idToken: "fake_google_id_token",
      expiryDate: Date.now() + 3600 * 1000,
      scope: "https://www.googleapis.com/auth/calendar.events",
      tokenType: "Bearer",
    };
  }

  async listEvents(
    _tokens: GoogleOAuthTokens,
    _options: { timeMin: Date; timeMax: Date },
  ): Promise<CalendarEventItem[]> {
    return [...this.fakeEvents];
  }

  async createEvent(
    _tokens: GoogleOAuthTokens,
    event: CreateCalendarEventInput,
  ): Promise<{ id: string; htmlLink: string }> {
    const id = `evt-ai-booked-${Date.now()}`;
    const newEvent: CalendarEventItem = {
      id,
      title: event.title,
      start: event.start.toISOString(),
      end: event.end.toISOString(),
      description: event.description,
      location: event.location,
      attendees: event.attendees,
      htmlLink: `https://calendar.google.com/event?eid=${id}`,
      status: "scheduled",
      isAiBooked: true,
    };
    this.fakeEvents.push(newEvent);
    return { id, htmlLink: newEvent.htmlLink! };
  }
}
