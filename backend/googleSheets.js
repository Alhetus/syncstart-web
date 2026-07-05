import { sheets, auth } from "@googleapis/sheets";

// Thin wrapper around the Google Sheets API. Configuration is injected so this
// module reads no environment variables of its own.
//
// GoogleAuth resolves the underlying client lazily on the first request, so no
// startup await/race is needed.
export const createGoogleSheets = ({ keyFile, spreadsheetId, tabName }) => {
  const googleAuth = new auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  const googleSheets = sheets({ version: "v4", auth: googleAuth });

  // Confirm the credentials authenticate and the service account can actually
  // reach the target spreadsheet. Returns the spreadsheet title on success.
  const verifyAccess = async () => {
    const res = await googleSheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties.title"
    });
    return res.data.properties.title;
  };

  const appendScores = async (scoreValues) => {
    console.log(`Sending ${scoreValues.length} scores to google sheets`);

    await googleSheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tabName}!A:O`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: scoreValues
      }
    });
  };

  return { verifyAccess, appendScores };
};
