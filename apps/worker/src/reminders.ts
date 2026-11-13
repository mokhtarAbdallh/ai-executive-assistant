/**
 * Reminder email delivery (ADR-020).
 *
 * The default channel is "console" (log-only, no side effects). When EMAIL_FROM
 * is configured the dispatcher uses SES; ses client is imported lazily-guarded
 * via the sender constructed in main.ts so tests never need credentials.
 */

import {
  SESv2Client,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";

export interface EmailInputLike {
  to: string;
  subject: string;
  body: string;
}

export interface ReminderEmailSender {
  sendEmail(input: EmailInputLike): Promise<{ messageId: string }>;
}

/** Development/testing sender: logs to stdout, never touches a network. */
export class ConsoleEmailSender implements ReminderEmailSender {
  sendEmail(input: EmailInputLike): Promise<{ messageId: string }> {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        time: new Date().toISOString(),
        msg: "EMAIL (console sender)",
        to: input.to,
        subject: input.subject,
      }) + "\n",
    );
    return Promise.resolve({ messageId: "console" });
  }
}

export interface SesEmailSenderOptions {
  region: string;
  fromAddress: string;
  endpointUrl?: string | undefined;
}

/** Production sender backed by SESv2 (Simple email content, UTF-8). */
export class SesEmailSender implements ReminderEmailSender {
  private readonly client: SESv2Client;
  private readonly fromAddress: string;

  constructor(options: SesEmailSenderOptions) {
    this.client = new SESv2Client({
      region: options.region,
      endpoint: options.endpointUrl,
    });
    this.fromAddress = options.fromAddress;
  }

  async sendEmail(input: EmailInputLike): Promise<{ messageId: string }> {
    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.fromAddress,
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: input.subject, Charset: "utf-8" },
            Body: { Text: { Data: input.body, Charset: "utf-8" } },
          },
        },
      }),
    );
    return { messageId: result.MessageId ?? "unknown" };
  }
}
