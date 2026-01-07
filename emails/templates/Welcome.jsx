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
  firstName = "",
  email = "subscriber@example.com",
}) {
  const greeting = firstName ? `Welcome, ${firstName}!` : "Welcome to BevAlc Intelligence!";

  return (
    <Layout preview="You're all set to receive weekly TTB COLA insights">
      <Heading style={styles.heading}>{greeting}</Heading>

      <Text style={styles.paragraph}>
        Thanks for signing up. You'll now receive our free weekly snapshot of
        TTB COLA filings, straight to your inbox every Monday.
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
                Weekly PDF report with new TTB approvals
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
                Market trends and filing activity insights
              </Text>
            </td>
          </tr>
        </table>
      </Section>

      {/* Explore Database CTA */}
      <Text style={styles.paragraph}>
        While you wait for your first report, explore our database of over 1
        million COLA records:
      </Text>

      <Section style={{ textAlign: "center", marginTop: "24px" }}>
        <Button href="https://bevalcintel.com/database" style={styles.button}>
          Search the Database
        </Button>
      </Section>

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
          Need more?
        </Text>
        <Text
          style={{
            fontSize: "14px",
            color: colors.textSecondary,
            margin: "0 0 12px 0",
          }}
        >
          Pro members get category-specific reports, watchlist alerts for
          specific brands and companies, and unlimited CSV exports.
        </Text>
        <Link
          href="https://bevalcintel.com/pricing"
          style={{
            ...styles.link,
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          Learn about Pro
        </Link>
      </Section>
    </Layout>
  );
}

// Default export for React Email preview
export default Welcome;
