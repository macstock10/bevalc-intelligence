import {
  Button,
  Heading,
  Hr,
  Link,
  Section,
  Text,
} from "@react-email/components";
import { Layout, styles, colors } from "../components/Layout.jsx";

export function WeeklyReport({
  weekEnding = "January 5, 2026",
  downloadLink = "https://pub-xxx.r2.dev/weekly/2026-01-05/bevalc_weekly_snapshot.pdf",
  newFilingsCount = "847",
  newBrandsCount = "23",
}) {
  return (
    <Layout preview={`Your BevAlc Weekly Snapshot for ${weekEnding}`}>
      <Heading style={styles.heading}>
        Your Weekly Snapshot is Ready
      </Heading>

      <Text style={styles.paragraph}>
        Here's your BevAlc Intelligence report for the week ending{" "}
        <strong style={{ color: colors.text }}>{weekEnding}</strong>.
      </Text>

      {/* Stats Section */}
      <Section
        style={{
          backgroundColor: colors.bgTertiary,
          borderRadius: "8px",
          padding: "20px",
          marginBottom: "24px",
        }}
      >
        <table width="100%" cellPadding="0" cellSpacing="0">
          <tr>
            <td style={{ textAlign: "center", padding: "8px" }}>
              <Text
                style={{
                  fontSize: "28px",
                  fontWeight: "700",
                  color: colors.primary,
                  margin: "0",
                  lineHeight: "1",
                }}
              >
                {newFilingsCount}
              </Text>
              <Text
                style={{
                  fontSize: "12px",
                  color: colors.textSecondary,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  margin: "4px 0 0 0",
                }}
              >
                New Filings
              </Text>
            </td>
            <td
              style={{
                width: "1px",
                backgroundColor: colors.border,
                padding: "0",
              }}
            ></td>
            <td style={{ textAlign: "center", padding: "8px" }}>
              <Text
                style={{
                  fontSize: "28px",
                  fontWeight: "700",
                  color: colors.primary,
                  margin: "0",
                  lineHeight: "1",
                }}
              >
                {newBrandsCount}
              </Text>
              <Text
                style={{
                  fontSize: "12px",
                  color: colors.textSecondary,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  margin: "4px 0 0 0",
                }}
              >
                New Brands
              </Text>
            </td>
          </tr>
        </table>
      </Section>

      <Text style={styles.paragraph}>
        This week's report includes the latest TTB COLA approvals, new brand
        launches, and market activity across all beverage alcohol categories.
      </Text>

      {/* Download Button */}
      <Section style={{ textAlign: "center", marginTop: "24px" }}>
        <Button href={downloadLink} style={styles.button}>
          Download PDF Report
        </Button>
      </Section>

      <Text
        style={{
          ...styles.paragraph,
          fontSize: "14px",
          textAlign: "center",
          marginTop: "16px",
        }}
      >
        Or copy this link:{" "}
        <Link href={downloadLink} style={styles.link}>
          {downloadLink}
        </Link>
      </Text>

      <Hr style={styles.divider} />

      {/* Pro Upsell */}
      <Section
        style={{
          backgroundColor: colors.primaryLight,
          borderRadius: "8px",
          padding: "20px",
          textAlign: "center",
        }}
      >
        <Text
          style={{
            fontSize: "14px",
            fontWeight: "600",
            color: colors.primary,
            margin: "0 0 8px 0",
          }}
        >
          Want more insights?
        </Text>
        <Text
          style={{
            fontSize: "14px",
            color: colors.textSecondary,
            margin: "0 0 12px 0",
          }}
        >
          Pro members get category-specific reports, watchlist alerts, and
          unlimited CSV exports.
        </Text>
        <Link
          href="https://bevalcintel.com/pricing"
          style={{
            ...styles.link,
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          Upgrade to Pro
        </Link>
      </Section>
    </Layout>
  );
}

// Default export for React Email preview
export default WeeklyReport;
