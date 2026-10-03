import { Capacitor } from '@capacitor/core';

export interface PhotoResult {
  dataUrl: string;  // base64 data URL
  format: string;
}

export async function takePhoto(): Promise<PhotoResult | null> {
  if (!Capacitor.isNativePlatform()) {
    // Web fallback: use file input
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () => resolve({ dataUrl: reader.result as string, format: file.type });
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  
  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt, // Lets user choose camera or gallery
      width: 1200,
      height: 1200,
    });
    
    return {
      dataUrl: photo.dataUrl!,
      format: photo.format,
    };
  } catch (e) {
    console.log('Camera cancelled or error:', e);
    return null;
  }
}

export async function pickFromGallery(): Promise<PhotoResult | null> {
  if (!Capacitor.isNativePlatform()) {
    return takePhoto(); // Same file picker on web
  }

  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  
  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Photos,
      width: 1200,
      height: 1200,
    });
    
    return {
      dataUrl: photo.dataUrl!,
      format: photo.format,
    };
  } catch (e) {
    console.log('Gallery cancelled or error:', e);
    return null;
  }
}
