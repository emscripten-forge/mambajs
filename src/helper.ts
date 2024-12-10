export const fetchJson = async (url: string): Promise<any> => {
  let response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  let json = await response.json();
  return json;
};
