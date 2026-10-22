export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

export interface SendReminderInput {
  recipientId: string;
  channel: string;
  remindAt: Date;
  note: string;
}

export interface NotificationResult {
  messageId: string;
  delivered: boolean;
  channel: string;
  timestamp: Date;
}

export interface NotificationProvider {
  sendEmail(input: SendEmailInput): Promise<NotificationResult>;
  sendReminder(input: SendReminderInput): Promise<NotificationResult>;
}

export class ConsoleNotificationProvider implements NotificationProvider {
  async sendEmail(input: SendEmailInput): Promise<NotificationResult> {
    const messageId = `email-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    // Console log for demo/local environment as per ADR-010
    console.warn(`[ConsoleNotificationProvider] Sending email to ${input.to} | Subject: "${input.subject}" | MessageId: ${messageId}`);
    return {
      messageId,
      delivered: true,
      channel: "email",
      timestamp: new Date(),
    };
  }

  async sendReminder(input: SendReminderInput): Promise<NotificationResult> {
    const messageId = `remind-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    console.warn(`[ConsoleNotificationProvider] Scheduled reminder for ${input.recipientId} at ${input.remindAt.toISOString()} | Note: "${input.note}" | MessageId: ${messageId}`);
    return {
      messageId,
      delivered: true,
      channel: input.channel,
      timestamp: new Date(),
    };
  }
}
