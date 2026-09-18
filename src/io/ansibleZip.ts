import type { AnsibleFile } from '../derive/ansible'

/** The Ansible export as a zip archive with every file under one folder.
 *  JSZip is loaded on demand, like exceljs for the xlsx export. */
export async function ansibleZip(files: AnsibleFile[], folder: string): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const root = zip.folder(folder)!
  // A fixed date keeps the archive identical for an unchanged plan.
  const date = new Date(Date.UTC(2020, 0, 1))
  for (const f of files) root.file(f.path, f.content, { date })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
