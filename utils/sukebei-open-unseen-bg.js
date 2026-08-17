export const OPEN_INTERVAL_MS = 3000;

export const visitUrlVariants = (url) => {
  try {
    const parsed = new URL(url);
    const other = parsed.protocol === "https:" ? "http:" : "https:";
    return [
      parsed.href,
      `${other}//${parsed.host}${parsed.pathname}${parsed.search}`,
    ];
  } catch {
    return [url];
  }
};

export const urlHasVisits = async (url, getVisits) => {
  for (const candidate of visitUrlVariants(url)) {
    const visits = await getVisits(candidate);
    if (Array.isArray(visits) && visits.length > 0) {
      return true;
    }
  }
  return false;
};

export const filterUnvisited = async (urls, getVisits) => {
  const unseen = [];
  for (const url of urls) {
    if (!(await urlHasVisits(url, getVisits))) {
      unseen.push(url);
    }
  }
  return unseen;
};
