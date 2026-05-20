# Accumn Insights Integration

## Endpoints

| Environment | URL |
|-------------|-----|
| UAT | `https://dev-unicore-api.accumn.co/los/api/v1/api-details` |
| Production | `https://unicore-api.accumn.ai/los/api/v1/api-details` |

---

## 1. Login and Access Token

> An email ID is required for creating the user against which login credentials and authentication will be configured. A monitored email is recommended as it can be repurposed for automated notifications.

**Method:** `POST`

### Request

```json
{
  "request": "login",
  "param": {
    "emailId": "user@domain.com",
    "password": "A***********8"
  }
}
```

### Success Response

```json
{
  "statusCode": 1,
  "data": {
    "api_auth_token": "52uhRRlStvq4GZKWDZEi6Y0ocpJAD"
  },
  "msg": "Login Successful"
}
```

> **Note:** The auth token does not expire unless the password is changed.

### Failure Responses

| Scenario | Request | Response |
|----------|---------|----------|
| Invalid User | `emailId: "abc.xyz"` | `"msg": "user does not exists"` |
| Invalid request field | `"request": "xyz"` | `"msg": "Invalid request key"` |
| Request field missing | *(no `request` key)* | `"msg": "request key required"` |
| Param field missing | *(no `param` key)* | `"msg": "param key required"` |
| Invalid email/password | Wrong credentials | `"msg": "You have entered an invalid email address or password. Please try again."` |

All failure responses follow this structure:

```json
{
  "statusCode": 0,
  "data": null,
  "msg": "<error message>"
}
```

---

## 2. Create Order

- Order can be placed using either the **CIN** or **PAN** of the company.
- Set `"identifier"` to `"CIN"` or `"PAN"` and pass the corresponding value in `"value"`.

**Method:** `POST`

### Request

```json
{
  "request": "create-order",
  "param": {
    "lenderInfo": {
      "lender_referenceNumber": "InsightsTest123",
      "lender_source": "los",
      "lender_name": "LENDERNAME"
    },
    "requestorInfo": {
      "requestor_division": "LENDER_DIVISION",
      "requestor_branch": "LENDER_BRANCH",
      "requestor_name": "BANK TESTER",
      "requestor_email": "requestor@domain.com",
      "requestor_phone": "9663533361"
    },
    "borrowerInfo": {
      "borrower_name": "Test Company Private Limited"
    },
    "dataRelatedInfo": {
      "insightsInfo": {
        "identifier": "PAN",
        "value": "AAACK4409J"
      }
    },
    "orderInfo": {
      "product_name": "INSIGHTS"
    },
    "webhook_urls": [
      {
        "webhook_url": "https://domain.com/1.0/webhook_report/token/value",
        "key_name": "webhook_value",
        "key_value": "webhook_token"
      }
    ]
  }
}
```

### Parameter Details

| Parameter | Details |
|-----------|---------|
| `lender_name` | Provided by Accumn |
| `requestor_division` | Provided by Accumn |
| `requestor_branch` | Provided by Accumn |
| `borrower_name` | Mandatory. Pass `""` if not available |
| `identifier` | Enum: `PAN` or `CIN` |
| `value` | Actual PAN or CIN number |
| `product_name` | Always `"INSIGHTS"` — fetches latest data for the company |

---

## 3. Check Order Status

**Method:** `POST`

**Header:**
```
client-security-token: <Auth token from login>
```

### Request

```json
{
  "request": "check-order-status",
  "param": {
    "ffOrderId": "FU24120112345"
  }
}
```

> **Note:** `ffOrderId` is mandatory.

### Success Response

```json
{
  "statusCode": 1,
  "data": {
    "ffOrderId": "FF25120809253",
    "lender_referenceNumber": "TestOrder03434v23415",
    "order_status": "Completed",
    "client_ref_details": null,
    "order_details": [
      {
        "source": "INSIGHTS",
        "order_status": "Completed",
        "key": "U72900RJ2020PTC068502",
        "remarks": ""
      }
    ]
  },
  "msg": "Success"
}
```

### Order Statuses

| Status | Description |
|--------|-------------|
| `In Progress` | Order is being processed |
| `Completed` | Order fulfilled successfully |
| `Cancelled` | Order was cancelled |

> Status can be accessed via **callback (webhook)** or by **polling this API**.

### Failure Responses

| Scenario | Response |
|----------|----------|
| Invalid `ffOrderId` | `"msg": "Order Not Found"` |
| Missing `ffOrderId` | `"msg": "FF order id not found"` |
| Invalid request value | `"msg": "Invalid request key"` |

---

## 4. Webhook — Push Order Status

On order completion or cancellation, the status is pushed to the client-provided webhook URL.

> This feature must be **explicitly enabled** during integration setup. It is **disabled by default**.

### Webhook Configuration (provided at order creation)

```json
"webhook_urls": [
  {
    "webhook_url": "https://domain.com/1.0/webhook_report/token/value",
    "key_name": "webhook_token",
    "key_value": "webhook_value"
  }
]
```

### Payload Sent to Client Webhook

```json
{
  "statusCode": 1,
  "data": {
    "ffOrderId": "FF25120809253",
    "lender_referenceNumber": "TestOrder03434v23415",
    "order_status": "Completed",
    "client_ref_details": null,
    "order_details": [
      {
        "source": "INSIGHTS",
        "order_status": "Completed",
        "key": "U72900RJ2020PTC068502",
        "remarks": ""
      }
    ]
  },
  "msg": "Success"
}
```

> **Expected behavior:** The client must return a success response to acknowledge receipt.
> If the delivery fails due to system unavailability, the request will be retried at regular intervals.
> Any other failure scenarios should be discussed separately during implementation.

---

## 5. Fetch Files and Reports (`get-file-details`)

> **Important:** Always check the order status before calling this API. Partial or no files may be available if the download is still in progress.

Available files on order completion:

- JSON output file (`MRD`)
- Reports: PDF, Excel, Flag Report
- Raw files: MCA source files (as-is)

**Method:** `POST`

**Header:**
```
client-security-token: <Auth token from login>
```

### Request

```json
{
  "request": "get-file-details",
  "param": {
    "ffOrderId": "FF25120809253",
    "incremental": false
  }
}
```

### `incremental` Flag Behavior

| Value | Behavior |
|-------|----------|
| `false` *(default)* | Downloads all available files for the order |
| `true` | Downloads only files not previously downloaded; skips already-fetched files |

### Success Response

```json
{
  "statusCode": 1,
  "data": {
    "ffOrderId": "FF25120809253",
    "client_ref_details": null,
    "file_details": [
      {
        "source": "INSIGHTS",
        "file_id": 27680434,
        "file_name": "COMPANY NAME_advanced_report.pdf",
        "file_category": "REPORT",
        "mime_type": "application/pdf",
        "file_size_in_bytes": 308016,
        "download_url": "<presigned S3 URL>",
        "url_expiry_time_epoch_ms": 1767081964541,
        "key": ""
      },
      {
        "source": "INSIGHTS",
        "file_id": 27680435,
        "file_name": "COMPANY NAME_flags.pdf",
        "file_category": "REPORT",
        "mime_type": "application/pdf",
        "file_size_in_bytes": 184620,
        "download_url": "<presigned S3 URL>",
        "url_expiry_time_epoch_ms": 1767081964541,
        "key": ""
      },
      {
        "source": "INSIGHTS",
        "file_id": 27680436,
        "file_name": "COMPANY NAME_advance_excel_report.xlsx",
        "file_category": "REPORT",
        "mime_type": "application/xlsx",
        "file_size_in_bytes": 250783,
        "download_url": "<presigned S3 URL>",
        "url_expiry_time_epoch_ms": 1767081964541,
        "key": ""
      },
      {
        "source": "INSIGHTS",
        "file_id": 27682596,
        "file_name": "MRD_COMPANY NAME_comprehensive.json",
        "file_category": "MRD",
        "mime_type": "application/json",
        "file_size_in_bytes": 90714,
        "download_url": "<presigned S3 URL>",
        "url_expiry_time_epoch_ms": 1767081964541,
        "key": ""
      },
      {
        "source": "INSIGHTS",
        "file_id": 27692413,
        "file_name": "COMPANY NAME.zip",
        "file_category": "REPORT",
        "mime_type": "application/zip",
        "file_size_in_bytes": 46717491,
        "download_url": "<presigned S3 URL>",
        "url_expiry_time_epoch_ms": 1767081964542,
        "key": ""
      }
    ]
  },
  "msg": "get file details api called successfully"
}
```

### File Categories

| `file_category` | Description |
|-----------------|-------------|
| `REPORT` | PDF advanced report, flags report, Excel report, ZIP of raw MCA files |
| `MRD` | Machine-readable JSON data (comprehensive) |

### Failure Responses

| Scenario | Response |
|----------|----------|
| Wrong `ffOrderId` | `"msg": "File details not found for :<ffOrderId>"` |
| Missing `ffOrderId` | `"msg": "ffOrderId is Null or empty"` |
| Invalid request value | `"msg": "Invalid request key"` |
