// controller/import-controller.ts
import { defaultQdpxCoder, parseQdpx, qdpxToProject } from '../model/formats/refi';
import type { ImportView, QdpxPurpose } from '../view/importView';
import type { Project } from '../model/types';

export class ImportController {
  constructor(private view: ImportView) {}

  /** Returns the project, or `undefined` if the user cancelled. */
  async importQdpx(bytes: Uint8Array, fileName: string, purpose: QdpxPurpose): Promise<Project | undefined> {
    const parsed = parseQdpx(bytes);

    let mine = defaultQdpxCoder(parsed);
    if (mine === undefined) {
      mine = await this.view.askCoder(fileName, parsed.users, purpose);
      if (mine === undefined) return undefined; // cancelled
    }

    this.view.showSkipped(parsed.skipped);
    return qdpxToProject(parsed, mine);
  }
}