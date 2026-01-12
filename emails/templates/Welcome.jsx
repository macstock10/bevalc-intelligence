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

export function Welcome({
  email = "subscriber@example.com",
}) {
  const greeting = "Welcome to BevAlc Intelligence!";

  return (
    <Layout preview="You're all set to receive weekly TTB COLA insights">
      <Heading style={styles.heading}>{greeting}</Heading>

      <Text style={styles.paragraph}>
        Thanks for signing up. You'll now receive our free weekly snapshot of
        TTB COLA filings every Saturday, covering the prior week's approvals.
      </Text>

      <Text style={{ ...styles.paragraph, fontSize: "13px", color: colors.textSecondary, fontStyle: "italic" }}>
        Note: TTB data can take up to 7 days to fully populate. Our scrapers run daily with a rolling window to catch records as they're published.
      </Text>

      {/* What You'll Get Section */}
      <Section
        style={{
          backgroundColor: colors.bgTertiary,
          borderRadius: "8px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        <Text
          style={{
            fontSize: "14px",
            fontWeight: "600",
            color: colors.text,
            margin: "0 0 16px 0",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          What you'll get
        </Text>

        <table width="100%" cellPadding="0" cellSpacing="0">
          <tr>
            <td style={{ padding: "8px 0" }}>
              <Text style={{ margin: 0, color: colors.textSecondary, fontSize: "15px" }}>
                <span style={{ color: colors.primary, marginRight: "8px" }}>&#10003;</span>
                Weekly email with new TTB approvals
              </Text>
            </td>
          </tr>
          <tr>
            <td style={{ padding: "8px 0" }}>
              <Text style={{ margin: 0, color: colors.textSecondary, fontSize: "15px" }}>
                <span style={{ color: colors.primary, marginRight: "8px" }}>&#10003;</span>
                New brand and SKU launches across all categories
              </Text>
            </td>
          </tr>
          <tr>
            <td style={{ padding: "8px 0" }}>
              <Text style={{ margin: 0, color: colors.textSecondary, fontSize: "15px" }}>
                <span style={{ color: colors.primary, marginRight: "8px" }}>&#10003;</span>
                Top filers and category trends
              </Text>
            </td>
          </tr>
        </table>
      </Section>

      {/* Explore Database CTA */}
      <Text style={styles.paragraph}>
        While you wait for your first report, explore our database of over 2
        million COLA records:
      </Text>

      <Section style={{ textAlign: "center", marginTop: "24px" }}>
        <Button href="https://bevalcintel.com/database" style={styles.button}>
          Search the Database
        </Button>
      </Section>

      <Hr style={styles.divider} />

      {/* Upgrade Options */}
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
            margin: "0 0 12px 0",
          }}
        >
          Ready for More?
        </Text>
        <Text
          style={{
            fontSize: "13px",
            color: colors.textSecondary,
            margin: "0 0 8px 0",
            lineHeight: "1.5",
          }}
        >
          <strong>Category Pro ($29/mo)</strong> — Focus on one category with full signals, watchlist alerts, and CSV exports.
        </Text>
        <Text
          style={{
            fontSize: "13px",
            color: colors.textSecondary,
            margin: "0 0 12px 0",
            lineHeight: "1.5",
          }}
        >
          <strong>Premier ($79/mo)</strong> — Full access to all categories with complete market intelligence.
        </Text>
        <Link
          href="https://bevalcintel.com/#pricing"
          style={{
            ...styles.link,
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          Compare Plans
        </Link>
      </Section>
    </Layout>
  );
}

// Default export for React Email preview
export default Welcome;
