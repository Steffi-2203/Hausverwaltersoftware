import { db } from "../db";
import { maintenanceContracts, properties, contractors, messages } from "@shared/schema";
import { eq, and, gte, lte, isNull } from "drizzle-orm";
import { sendEmail } from "../lib/resend";
import { format, addDays, addMonths, differenceInDays } from "date-fns";
import { de } from "date-fns/locale";

interface MaintenanceReminder {
  contractId: string;
  contractName: string;
  propertyName: string;
  contractorName: string;
  contractorEmail: string | null;
  dueDate: Date;
  daysUntilDue: number;
  intervalMonths: number;
  cost: number;
  reminderType: 'upcoming' | 'due' | 'overdue';
}

export class MaintenanceReminderService {
  async checkMaintenanceReminders(organizationId: string): Promise<MaintenanceReminder[]> {
    const today = new Date();
    const lookAheadDays = 30;
    const lookAheadDate = addDays(today, lookAheadDays);

    const contracts = await db.select({
      contract: maintenanceContracts,
      property: properties,
      contractor: contractors,
    })
      .from(maintenanceContracts)
      .innerJoin(properties, eq(maintenanceContracts.propertyId, properties.id))
      .leftJoin(contractors, eq(maintenanceContracts.contractorId, contractors.id))
      .where(and(
        eq(properties.organizationId, organizationId),
        eq(maintenanceContracts.isActive, true)
      ));

    const reminders: MaintenanceReminder[] = [];

    for (const row of contracts) {
      const lastService = row.contract.lastServiceDate 
        ? new Date(row.contract.lastServiceDate) 
        : new Date(row.contract.startDate);
      
      const intervalMonths = row.contract.intervalMonths || 12;
      const nextDueDate = addMonths(lastService, intervalMonths);
      const daysUntilDue = differenceInDays(nextDueDate, today);

      let reminderType: 'upcoming' | 'due' | 'overdue';
      if (daysUntilDue < 0) {
        reminderType = 'overdue';
      } else if (daysUntilDue <= 7) {
        reminderType = 'due';
      } else if (daysUntilDue <= lookAheadDays) {
        reminderType = 'upcoming';
      } else {
        continue;
      }

      reminders.push({
        contractId: row.contract.id,
        contractName: row.contract.name || 'Wartungsvertrag',
        propertyName: row.property.name || '',
        contractorName: row.contractor?.name || 'Nicht zugewiesen',
        contractorEmail: row.contractor?.email || null,
        dueDate: nextDueDate,
        daysUntilDue,
        intervalMonths,
        cost: Number(row.contract.cost) || 0,
        reminderType,
      });
    }

    return reminders.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }

  async sendMaintenanceReminders(
    organizationId: string,
    managerEmail: string
  ): Promise<{ sent: number; reminders: MaintenanceReminder[] }> {
    const reminders = await this.checkMaintenanceReminders(organizationId);
    
    if (reminders.length === 0) {
      return { sent: 0, reminders: [] };
    }

    const overdueReminders = reminders.filter(r => r.reminderType === 'overdue');
    const dueReminders = reminders.filter(r => r.reminderType === 'due');
    const upcomingReminders = reminders.filter(r => r.reminderType === 'upcoming');

    let emailBody = `
      <h2>Wartungserinnerungen</h2>
      <p>Hier ist eine Übersicht der anstehenden und überfälligen Wartungen:</p>
    `;

    if (overdueReminders.length > 0) {
      emailBody += `
        <h3 style="color: #dc2626;">Überfällige Wartungen (${overdueReminders.length})</h3>
        <table style="border-collapse: collapse; width: 100%;">
          <tr style="background: #fef2f2;">
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Vertrag</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Objekt</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Firma</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Fällig seit</th>
          </tr>
          ${overdueReminders.map(r => `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${r.contractName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${r.propertyName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${r.contractorName}</td>
              <td style="padding: 8px; border: 1px solid #ddd; color: #dc2626;">${Math.abs(r.daysUntilDue)} Tage</td>
            </tr>
          `).join('')}
        </table>
      `;
    }

    if (dueReminders.length > 0) {
      emailBody += `
        <h3 style="color: #f59e0b;">Diese Woche fällig (${dueReminders.length})</h3>
        <table style="border-collapse: collapse; width: 100%;">
          <tr style="background: #fffbeb;">
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Vertrag</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Objekt</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Firma</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Fällig am</th>
          </tr>
          ${dueReminders.map(r => `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${r.contractName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${r.propertyName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${r.contractorName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${format(r.dueDate, 'dd.MM.yyyy', { locale: de })}</td>
            </tr>
          `).join('')}
        </table>
      `;
    }

    if (upcomingReminders.length > 0) {
      emailBody += `
        <h3 style="color: #3b82f6;">Anstehend (${upcomingReminders.length})</h3>
        <table style="border-collapse: collapse; width: 100%;">
          <tr style="background: #eff6ff;">
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Vertrag</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Objekt</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Firma</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Fällig in</th>
          </tr>
          ${upcomingReminders.map(r => `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${r.contractName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${r.propertyName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${r.contractorName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${r.daysUntilDue} Tage</td>
            </tr>
          `).join('')}
        </table>
      `;
    }

    try {
      await sendEmail({
        to: managerEmail,
        subject: `Wartungserinnerungen: ${overdueReminders.length} überfällig, ${dueReminders.length} diese Woche fällig`,
        html: emailBody,
      });

      return { sent: 1, reminders };
    } catch (error) {
      console.error('Failed to send maintenance reminders:', error);
      return { sent: 0, reminders };
    }
  }
}

export const maintenanceReminderService = new MaintenanceReminderService();
