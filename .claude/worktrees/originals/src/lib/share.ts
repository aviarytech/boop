import { Capacitor } from '@capacitor/core';

export async function shareList(listName: string, listUrl: string) {
  if (!Capacitor.isNativePlatform()) {
    // Web fallback: use Web Share API or clipboard
    if (navigator.share) {
      await navigator.share({ title: listName, text: `Check out my list: ${listName}`, url: listUrl });
    } else {
      await navigator.clipboard.writeText(listUrl);
      // TODO: show toast "Link copied!"
    }
    return;
  }
  
  const { Share } = await import('@capacitor/share');
  await Share.share({
    title: listName,
    text: `Check out my list: ${listName}`,
    url: listUrl,
    dialogTitle: 'Share this list',
  });
}

export async function shareItem(itemText: string, listName: string, listUrl: string) {
  if (!Capacitor.isNativePlatform()) {
    if (navigator.share) {
      await navigator.share({ title: `${itemText} — ${listName}`, text: itemText, url: listUrl });
    } else {
      await navigator.clipboard.writeText(`${itemText} — ${listUrl}`);
    }
    return;
  }
  
  const { Share } = await import('@capacitor/share');
  await Share.share({
    title: itemText,
    text: `${itemText}\nFrom: ${listName}`,
    url: listUrl,
    dialogTitle: 'Share this item',
  });
}

export async function canShare(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return !!navigator.share;
  }
  return true; // Native always supports sharing
}
