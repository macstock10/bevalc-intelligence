import React from "react";
import {
  Button,
  Heading,
  Hr,
  Link,
  Section,
  Text,
} from "@react-email/components";
import { Layout, styles, colors } from "../components/Layout.jsx";

// Signal badge colors
const signalColors = {
  NEW_COMPANY: { bg: "#fef3c7", text: "#92400e" },
  NEW_BRAND: { bg: "#dbeafe", text: "#1e40af" },
  NEW_SKU: { bg: "#e0e7ff", text: "#3730a3" },
  REFILE: { bg: "#f1f5f9", text: "#475569" },
};

export function WatchlistAlert({
  matchCount = 0,
  matches = [],
  databaseUrl = "https://bevalcintel.com/database",
  accountUrl = "https://bevalcintel.com/account.html",
}) {
  const displayMatches = matches.slice(0, 20);
  const hasMore = matches.length > 20;

  return (
    <Layout preview={`${matchCount} new filing${matchCount === 1 ? '' : 's'} match your watchlist`}>
      <Heading style={styles.heading}>
        Watchlist Alert
      </Heading>

      <Text style={styles.paragraph}>
        {matchCount === 1
          ? "A new filing matches your watchlist:"
          : `${matchCount} new filings match your watchlist:`}
      </Text>

      <Text style={{ ...styles.paragraph, fontSize: "12px", color: colors.textTertiary, fontStyle: "italic", marginTop: "-8px" }}>
        Our scrapers run daily with a 7-day rolling window to catch records as TTB publishes them.
      </Text>

      {/* Matches List */}
      <Section
        style={{
          backgroundColor: colors.bgTertiary,
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "24px",
        }}
      >
        <table width="100%" cellPadding="0" cellSpacing="0">
          <tbody>
            {displayMatches.map((match, index) => {
              const signalStyle = signalColors[match.signal] || signalColors.REFILE;
              return (
                <tr key={index}>
                  <td style={{ padding: "10px 0", borderBottom: index < displayMatches.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
                    <Text style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: colors.text }}>
                      {match.brandName}
                      {match.fancifulName && (
                        <span style={{ fontWeight: "400" }}> - {match.fancifulName}</span>
                      )}
                    </Text>
                    <Text style={{ margin: "4px 0 0 0", fontSize: "13px", color: colors.textSecondary }}>
                      {match.companyName}
                    </Text>
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: "6px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: "500",
                        borderRadius: "4px",
                        backgroundColor: signalStyle.bg,
                        color: signalStyle.text,
                      }}
                    >
                      {match.signal?.replace("_", " ") || "FILING"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {hasMore && (
          <Text style={{ margin: "16px 0 0 0", fontSize: "14px", color: colors.textSecondary, textAlign: "center" }}>
            ... and {matches.length - 20} more
          </Text>
        )}
      </Section>

      {/* CTA Button */}
      <Section style={{ textAlign: "center", marginBottom: "24px" }}>
        <Button href={databaseUrl} style={styles.button}>
          View in Database
        </Button>
      </Section>

      <Hr style={styles.divider} />

      {/* Manage Watchlist */}
      <Text style={{ ...styles.paragraph, fontSize: "14px", textAlign: "center" }}>
        <Link href={accountUrl} style={styles.link}>
          Manage your watchlist
        </Link>
      </Text>
    </Layout>
  );
}

export default WatchlistAlert;
