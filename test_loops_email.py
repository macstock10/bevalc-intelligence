"""
Quick test to verify Loops transactional email works
"""
import requests

response = requests.post(
    "https://app.loops.so/api/v1/transactional",
    headers={
        "Authorization": "Bearer cbd87e0944cf95e2fb7f5c3d040fe8a8",
        "Content-Type": "application/json"
    },
    json={
        "transactionalId": "cmjz99oem02lk0i3bjdp66qu7",
        "email": "mac.rowan@outlook.com",
        "dataVariables": {
            "week_ending": "December 28, 2025",
            "download_link": "https://pub-1c889ae594b041a3b752c6c891eb718e.r2.dev/weekly/2025-12-28/bevalc_weekly_snapshot_2025-12-28.pdf"
        }
    }
)

print(f"Status: {response.status_code}")
print(f"Response: {response.text}")
