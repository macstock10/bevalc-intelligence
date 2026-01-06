import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

// BevAlc Intelligence brand colors (matches style.css)
export const colors = {
  primary: "#0d9488",
  primaryHover: "#0f766e",
  primaryLight: "#ccfbf1",
  text: "#1e293b",
  textSecondary: "#475569",
  textTertiary: "#94a3b8",
  bg: "#ffffff",
  bgSecondary: "#f8fafc",
  bgTertiary: "#f1f5f9",
  border: "#e2e8f0",
};

// Shared styles
export const styles = {
  main: {
    backgroundColor: colors.bgSecondary,
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  container: {
    margin: "0 auto",
    padding: "40px 20px",
    maxWidth: "600px",
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: "12px",
    border: `1px solid ${colors.border}`,
    padding: "32px",
  },
  header: {
    textAlign: "center",
    marginBottom: "32px",
  },
  logo: {
    color: colors.primary,
    fontSize: "24px",
    fontWeight: "600",
    textDecoration: "none",
  },
  heading: {
    fontFamily: 'Merriweather, Georgia, serif',
    fontSize: "24px",
    fontWeight: "700",
    color: colors.text,
    lineHeight: "1.3",
    margin: "0 0 16px 0",
  },
  paragraph: {
    fontSize: "16px",
    lineHeight: "1.6",
    color: colors.textSecondary,
    margin: "0 0 16px 0",
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: "8px",
    color: "#ffffff",
    fontSize: "16px",
    fontWeight: "500",
    textDecoration: "none",
    textAlign: "center",
    display: "inline-block",
    padding: "12px 24px",
  },
  link: {
    color: colors.primary,
    textDecoration: "none",
  },
  divider: {
    borderTop: `1px solid ${colors.border}`,
    margin: "24px 0",
  },
  footer: {
    textAlign: "center",
    marginTop: "32px",
  },
  footerText: {
    fontSize: "12px",
    color: colors.textTertiary,
    lineHeight: "1.5",
  },
  footerLink: {
    color: colors.textTertiary,
    textDecoration: "underline",
  },
};

export function Layout({ preview, children }) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          {/* Header */}
          <Section style={styles.header}>
            <Link href="https://bevalcintel.com" style={styles.logo}>
              BevAlc Intelligence
            </Link>
          </Section>

          {/* Main Content Card */}
          <Section style={styles.card}>
            {children}
          </Section>

          {/* Footer */}
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              BevAlc Intelligence - TTB COLA Database & Market Insights
              <br />
              <Link href="https://bevalcintel.com" style={styles.footerLink}>
                bevalcintel.com
              </Link>
              {" | "}
              <Link href="https://bevalcintel.com/database" style={styles.footerLink}>
                Search Database
              </Link>
            </Text>
            <Text style={styles.footerText}>
              You're receiving this because you signed up at bevalcintel.com.
              <br />
              <Link href="https://bevalcintel.com/preferences" style={styles.footerLink}>
                Manage preferences
              </Link>
              {" | "}
              <Link href="{{unsubscribeUrl}}" style={styles.footerLink}>
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default Layout;
