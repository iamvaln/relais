// Carnet de vie (Backend Specs §3.6, Techniques §10, E2-US07).
//
// Le contenu est chiffré K2 sur le device (content_enc) : le serveur ne
// garde que des métadonnées lisibles (mois, mode, question, taille
// approximative) et le blob. Une entrée par mois calendaire.

import { prisma } from '../../lib/prisma.js'
import { monthOf } from '../checkin/service.js'
import type { JournalMode } from './schemas.js'

// --- Question du mois -------------------------------------------------------------

export interface QuestionView {
  id: string
  text_fr: string
  text_en: string
  category: string
}

export interface MonthQuestionView {
  month: string
  mode: JournalMode
  question: QuestionView | null
  answered: boolean
}

/** Cycle annuel : une question par mois et par mode ; le mode libre n'en propose pas. */
export async function getQuestion(userId: string, mode: JournalMode = 'essential', now = new Date()): Promise<MonthQuestionView> {
  const month = monthOf(now)
  const question =
    mode === 'free'
      ? null
      : await prisma().checkin_questions.findFirst({
          where: { usage_type: 'journal', status: 'active', cycle_month: month.getUTCMonth() + 1, mode_target: mode },
          orderBy: { created_at: 'asc' },
          select: { id: true, text_fr: true, text_en: true, category: true },
        })
  const answered = await prisma().journal_entries.findUnique({
    where: { user_id_entry_month: { user_id: userId, entry_month: month } },
    select: { id: true },
  })
  return { month: month.toISOString().slice(0, 10), mode, question, answered: answered !== null }
}
