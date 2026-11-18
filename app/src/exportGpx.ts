import { File, Paths, Directory } from "expo-file-system";
import * as Sharing from "expo-sharing";
export async function exportGpx(content: string) {
  if (!(await Sharing.isAvailableAsync()))
    throw Error("File export is not available on this device.");
  const directory = new Directory(Paths.cache, "omnix-gpx");
  directory.create({ idempotent: true, intermediates: true });
  const previous = directory
    .list()
    .filter((item): item is File => item instanceof File)
    .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
  for (const file of previous.slice(9)) file.delete();
  const file = new File(directory, `omnix-walking-loop-${Date.now()}.gpx`);
  file.write(content);
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/gpx+xml",
    UTI: "com.topografix.gpx",
    dialogTitle: "Save or share walking route"
  });
}
