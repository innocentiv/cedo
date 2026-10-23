import { launchImageLibraryAsync } from 'expo-image-picker'

/** What was picked: the upload form the API takes (`file`), and how large the file is. */
export interface PickedImage {
  readonly form: FormData
  /** 0 when the platform does not say, which leaves the size to the API to refuse. */
  readonly bytes: number
}

/**
 * One image from the device's library, or null when nothing was picked. Expo's picker: a file input
 * on the web, the photo library natively (#10). On the web it hands back the File itself; natively
 * a file is named by its URI, which React Native's FormData reads in place of bytes. What is
 * accepted is the API's to say — refused, it says why.
 */
export async function pickImage(): Promise<PickedImage | null> {
  const picked = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
  const [asset] = picked.canceled ? [] : picked.assets
  if (asset === undefined) return null
  const form = new FormData()
  if (asset.file === undefined) {
    // React Native's FormData part: a URI with a name and a type, not a Blob — typed as one to fit.
    const part = {
      uri: asset.uri,
      name: asset.fileName ?? 'image',
      type: asset.mimeType ?? 'image/jpeg',
    } as unknown as Blob
    form.append('file', part)
  } else {
    form.append('file', asset.file)
  }
  return { form, bytes: asset.file?.size ?? asset.fileSize ?? 0 }
}
