// The questions and messages shown while importing.

import type { QdpxUser } from '../model/formats/refi';
import { choose, toast, type Choice } from './feedback';

/** Why a REFI-QDA project is being read: to open it, or to compare with one of its coders. */
export type QdpxPurpose = 'open' | 'compare';

export class ImportView {
    /**
     * Asks whose coding to use. Resolves with a user GUID, `null` for "none of them"
     * (only offered when opening), or `undefined` if cancelled.
     */
    askCoder(fileName: string, users: QdpxUser[], purpose: QdpxPurpose): Promise<string | null | undefined> {
        const choices: Choice<string | null>[] = users.map((u) => ({
            label: u.name,
            detail: `${u.codings} coding${u.codings === 1 ? '' : 's'}`,
            value: u.guid,
        }));

        return purpose === 'open'
            ? choose({
                title: `“${fileName}” contains coding by ${users.length} people. Which one are you?`,
                message: 'Everyone else is added under “Other coders” for comparison.',
                choices: [...choices, { label: 'I’m none of them', value: null }],
            })
            : choose({
                title: `“${fileName}” contains coding by ${users.length} people.`,
                message: 'Whose coding do you want to compare with yours?',
                choices,
            });
    }

    /** Tells the user what could not be imported. */
    showSkipped(skipped: { sources: number; selections: number }): void {
        if (skipped.sources) {
            toast(`Skipped ${skipped.sources} source(s) that are not text documents (e.g. PDFs, images, audio or video).`, 6000);
        }
        if (skipped.selections) {
            toast(`Skipped ${skipped.selections} coding(s) that refer to a code missing from the codebook.`, 6000);
        }
    }

    /**
     * Asks before replacing a non-empty project. Resolves `'export'` to download the current
     * project first and then replace it, `'replace'` to replace it directly, or `undefined` if cancelled.
     */
    confirmReplace(fileName: string, docs: number, segments: number): Promise<'export' | 'replace' | undefined> {
        return choose({
            title: `Do you want to export your current project before replacing it with “${fileName}”?`,
            message: `Your current project has ${docs} document(s) and ${segments} segment(s).`,
            choices: [
                { label: 'Yes, export current project, then replace it.', value: 'export' as const, primary: true },
                { label: 'No, delete current project and replace without exporting.', value: 'replace' as const },
            ],
            cancelLabel: 'Cancel and keep current project',
        });
    }

    /**
     * Asks who continues coding a project coded by someone else. Resolves with the chosen
     * name, or `undefined` if cancelled.
     */
    askContinuingCoder(me: string, theirs: string): Promise<string | undefined> {
        return choose({
            title: `This project was coded by “${theirs}”. Who will continue coding it?`,
            choices: [
                { label: me, detail: 'the existing coding is labelled as yours', value: me },
                { label: theirs, value: theirs },
            ],
        });
    }
}