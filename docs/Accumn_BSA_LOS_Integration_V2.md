# Accumn BSA LOS API Integration (Common LOS Platform)
**Integration Configuration Document — V2.0**

---

## Version Control

| Version | Date Updated  | Details of Change                                      | Author |
|---------|---------------|--------------------------------------------------------|--------|
| V2      | June 4th 2025 | Update contract for related party and cleanup for BSA orders | Ruchir |

---

> This document has the generic details of the configuration settings for LOS (API) integration with Accumn Common LOS platform. The document has generic details of requests, responses and errors. Any specific implementation / customization will be supplemented with an annexure with the details.

---

## Contents

1. [Login and Access Token](#1-login-and-access-token)
2. [Create Order](#2-create-order)
3. [Check Status](#3-check-status)
4. [Push Order Status on Webhook](#4-push-order-status-on-webhook)
5. [Fetching Data, Files and Reports (get-file-details)](#5-fetching-data-files-and-reports-get-file-details)
6. [Order Cancellation](#6-order-cancellation)
- [Appendix-1: Failure Responses for Login and Access Token](#appendix-1-failure-responses-for-login-and-access-token-requests)
- [Appendix-2: Order Creation Request Fields](#appendix-2-order-creation-request-fields-type-description-and-validation)
- [Appendix-3: Failure Responses for Order Creation](#appendix-3-failure-responses-for-order-creation-requests)
- [Appendix-4: Fields Description for get-file-details Response](#appendix-4-fields-description-for-get-file-details-response)
- [Appendix-5: Fields Description for Order Cancel Request](#appendix-5-fields-description-for-order-cancel-request)
- [Appendix-6: Failure Responses for Order Cancellation](#appendix-6-failure-responses-for-order-cancellation)

---

## 1. Login and Access Token

> **Note:** An email id is required for creating the user against which the login credentials and authentication will be configured. An email id that will be monitored is suggested as it can also be repurposed for any automated notifications that need to be sent as needed.

### a) Request for Login and Access Token

**URL Endpoints:**

| Environment | URL |
|-------------|-----|
| UAT         | `https://dev-unicore-api.accumn.co/los/api/v1/api-details` |
| Production  | `https://unicore-api.accumn.ai/los/api/v1/api-details` |

**Credentials:**
- Username: `user@domain.com`
- Password: `A***********8`

**Method:** `POST`

```json
{
  "request": "login",
  "param": {
    "emailId": "user@domain.com",
    "password": "A***********8"
  }
}
```

### b) Success Response

```json
{
  "statusCode": 1,
  "data": {
    "api_auth_token": "52uhRRlStvq4GZKWDZEi6Y0l9DocpJAD"
  },
  "msg": "Login Successful"
}
```

> **Note:** The auth token generated does not expire except in the event of a change in the password.

### c) Failure Responses

Failure scenarios and responses are provided in [Appendix-1](#appendix-1-failure-responses-for-login-and-access-token-requests).

---

## 2. Create Order

Create Order API enables creating an order on the Accumn system for processing the bank statements uploaded and provides for extraction of data to generate the necessary reports and analysis.

### a) Request for Order Creation

**URL Endpoints:**

| Environment | URL |
|-------------|-----|
| UAT         | `https://dev-unicore-api.accumn.co/los/api/v1/api-details` |
| Production  | `https://unicore-api.accumn.ai/los/api/v1/api-details` |

**Method:** `POST`

**Headers:**
```
client-security-token: <Auth token received as a response of successful login>
content-type: application/json
```

**Body:**
```json
{
  "request": "create-order",
  "param": {
    "lenderInfo": {
      "lender_source": "los",
      "lender_referenceNumber": "TestOrder2103",
      "lender_name": "lender_name"
    },
    "requestorInfo": {
      "requestor_division": "lender_sample_division",
      "requestor_branch": "lender_sample_branch",
      "requestor_name": "sample_user_name",
      "requestor_phone": "9999999999",
      "requestor_email": "test@lendername.com"
    },
    "borrowerInfo": {
      "borrower_name": "TestBorrower",
      "borrower_pan": "",
      "borrower_related_parties": [
        {
          "non_trade_action": 0,
          "is_auto": 0,
          "related_parties": "samplerelatedpartyname",
          "relation": "Otherrelatedparty"
        }
      ]
    },
    "orderInfo": {
      "product_name": "BSA"
    },
    "dataRelatedInfo": {
      "bsaInfo": {
        "account_wise_sanction_limit": [
          {
            "bank_account_number": "123456789101112",
            "sanction_limit": 100000,
            "month_wise_sanction_limit": [
              {
                "from_month": "2023-01",
                "to_month": "2023-10",
                "sanction_limit": 100
              }
            ]
          }
        ],
        "poa_from_date": "2022-01",
        "poa_to_date": "2024-09",
        "passwords": [
          "password1",
          "password2"
        ]
      }
    },
    "webhook_urls": [
      {
        "webhook_url": "",
        "key_value": "",
        "key_name": ""
      }
    ]
  }
}
```

> **File Attachment:** Bank Statements can be attached in the form while calling the Create Order API. A single PDF or a ZIP of PDFs is accepted.
> - Key name: `bsaFiles`
> - Value: Bank Statements

> **Note:** Field descriptions and validations (Mandatory/Optional, field length, value validations etc.) are provided in [Appendix-2](#appendix-2-order-creation-request-fields-type-description-and-validation).

### b) Success Response for Order Creation

```json
{
  "statusCode": 1,
  "data": {
    "ffOrderId": "FU24120112345"
  },
  "msg": "Order created successfully"
}
```

### c) Failure Responses

On errors due to validation, an error response is returned and the order is not created. Refer to [Appendix-3](#appendix-3-failure-responses-for-order-creation-requests) for failure scenarios and corresponding error messages.

---

## 3. Check Status

Check Status API can be used to check the status of the order placed.

### a) Request for Order Status

**URL Endpoints:**

| Environment | URL |
|-------------|-----|
| UAT         | `https://dev-unicore-api.accumn.co/los/api/v1/api-details` |
| Production  | `https://unicore-api.accumn.ai/los/api/v1/api-details` |

**Method:** `POST`

**Headers:**
```
client-security-token: <Auth token received as a response of successful login>
```

**Body:**
```json
{
  "request": "check-order-status",
  "param": {
    "ffOrderId": "FU24120112345"
  }
}
```

> **Note:** `ffOrderId` is a mandatory field.

### b) Success Response for Order Status

```json
{
  "statusCode": 1,
  "data": {
    "ffOrderId": "FU24120112345",
    "lender_referenceNumber": "TestOrd2311656",
    "order_status": "Completed",
    "order_detail_status": [
      {
        "source": "BSA",
        "order_status": "Completed"
      }
    ]
  },
  "msg": "Success"
}
```

### c) Failure Responses for Order Status

| Scenario | Error Response |
|----------|----------------|
| Invalid `ffOrderId` | `{"statusCode": 0, "data": null, "msg": "Order Not Found"}` |
| `ffOrderId` missing | `{"statusCode": 0, "data": null, "msg": "FF order id not found"}` |
| Invalid value in request | `{"statusCode": 0, "data": null, "msg": "Invalid request key"}` |

---

## 4. Push Order Status on Webhook

The status of the order can be pushed on a webhook provided by the client. This allows an alternate option to be updated on the order status on the client-hosted webhook.

> **Configuration Required:** This feature must be enabled during integration by configuration. By default, this feature is **not enabled**.

The webhook details must be provided during order creation:

```json
"webhook_urls": [
  {
    "webhook_url": "https://domain.com/1.0/webhook_report/token/value",
    "key_name": "webhook_token",
    "key_value": "webhook_value"
  }
]
```

On completion (or cancellation) of the order, the status is pushed to the webhook in the below structure:

```json
{
  "statusCode": 1,
  "data": {
    "ffOrderId": "FU25071700162",
    "lender_referenceNumber": "TestOrder2103",
    "order_status": "In Progress",
    "client_ref_details": null,
    "order_details": [
      {
        "source": "BSA",
        "order_status": "In Progress",
        "key": ""
      }
    ]
  },
  "msg": "Success"
}
```

> **Note:** A success response on receipt of the above request is expected to be returned from the client to acknowledge the receipt of the status.

In the event of delivery failure due to unavailability of the receiving systems, the request will be reattempted at regular intervals. Any failure scenarios apart from unavailability of the receiving systems should be discussed for implementation.

---

## 5. Fetching Data, Files and Reports (get-file-details)

On completion of the downloads, the downloaded files, reports and machine-readable data are made available for fetching via this API.

**Available files on completion:**
- BSA Report (MS-Excel file)
- BSA Report (JSON)
- Standard PDF report

> **Important:** Check the status of the order before fetching files. Partial or no files may be available if the download is still in progress or delayed due to issues at the data source.

> **Note:** Machine-Readable Data is a standard offering and can be customized if needed. Sample format of these reports will be provided along with the integration document for reference.

### a) Request for get-file-details

**URL Endpoints:**

| Environment | URL |
|-------------|-----|
| UAT         | `https://dev-unicore-api.accumn.co/los/api/v1/api-details` |
| Production  | `https://unicore-api.accumn.ai/los/api/v1/api-details` |

**Headers:**
```
client-security-token: <Auth token received as a response of successful login>
```

**Body:**
```json
{
  "request": "get-file-details",
  "param": {
    "ffOrderId": "FU24120112345",
    "incremental": false
  }
}
```

> **Note:** `ffOrderId` is a mandatory field.

**`incremental` field behavior:**
- `false` (default) — All files available for the order at the time of the request are downloaded. If the field is not passed, it defaults to `false`.
- `true` — Only files not downloaded on an earlier attempt will be downloaded; already downloaded files are skipped.

### b) Success Response for get-file-details

```json
{
  "statusCode": 1,
  "msg": "get file details api called successfully",
  "data": {
    "file_details": [
      {
        "source": "BSA",
        "file_id": 40658,
        "file_name": "FU24120112345-INDSECE.pdf",
        "file_category": "REPORT",
        "mime_type": "application/pdf",
        "file_size_in_bytes": 79146,
        "download_url": "https://ufw-ff-corp-uat.s3.ap-south-1.amazonaws.com",
        "url_expiry_time_epoch_ms": 1733898233045,
        "key": "TESTA1234A"
      },
      {
        "source": "BSA",
        "file_id": 40678,
        "file_name": "FU24120112345_FF_BSA.xlsx",
        "file_category": "REPORT",
        "mime_type": "application/xlsx",
        "file_size_in_bytes": 51368,
        "download_url": "https://ufw-ff-corp-uat.s3.ap-south-1.amazonaws.com",
        "url_expiry_time_epoch_ms": 1733898233127,
        "key": "TESTA1234A"
      },
      {
        "source": "BSA",
        "file_id": 41107,
        "file_name": "MRD_FU24120112345_QE_Uni_BSA.json",
        "file_category": "MRD",
        "mime_type": "application/json",
        "file_size_in_bytes": 28570,
        "download_url": "https://ufw-ff-corp-uat.s3.ap-south-1.amazonaws.com",
        "url_expiry_time_epoch_ms": 1733923590798,
        "key": "TESTA1234A"
      }
    ]
  }
}
```

Field descriptions are provided in [Appendix-4](#appendix-4-fields-description-for-get-file-details-response).

### c) Failure Responses for get-file-details

| Scenario | Error Response |
|----------|----------------|
| Wrong `ffOrderId` | `{"statusCode": 0, "data": null, "msg": "File details not found for :FU24120300938"}` |
| Missing `ffOrderId` | `{"statusCode": 0, "data": null, "msg": "ffOrderId is Null or empty"}` |
| Invalid request | `{"statusCode": 0, "data": null, "msg": "Invalid request key"}` |

---

## 6. Order Cancellation

Order cancellation can be requested by sending the order details on the below API.

> **Note:** The order can be cancelled only up to a certain point in time after order creation. The process for cancellation and the cutoff time must be discussed with the Accumn SPoCs prior to integration.

### a) Request and Success Response for Order Cancel — Entire Order

**Request to cancel BSA order:**
```json
{
  "request": "cancel-order",
  "sourceSystem": 1,
  "param": {
    "ffOrderId": "FU24120112345",
    "remark": "",
    "order_details": []
  }
}
```

**Success Response:**
```json
{
  "statusCode": 1,
  "data": {
    "cancelledOrders": [
      {
        "source": "BSA",
        "status": "Cancelled"
      }
    ],
    "notCancelledOrders": []
  },
  "msg": "Order cancellation successfully"
}
```

### b) Failure Responses for Order Cancel

Failure scenarios and responses are provided in [Appendix-6](#appendix-6-failure-responses-for-order-cancellation).

---

## Appendix-1: Failure Responses for Login and Access Token Requests

| Scenario | Invalid Request | Error Response |
|----------|----------------|----------------|
| Invalid User | `{"request": "login", "param": {"emailId": "abc.xyz", "password": "Corpository123"}}` | `{"statusCode": 0, "data": null, "msg": "user does not exists"}` |
| Invalid request field | `{"request": "xyz", "param": {"emailId": "XXXXX@corpository.com", "password": "Abc@12345678"}}` | `{"statusCode": 0, "data": null, "msg": "Invalid request key"}` |
| Request field missing | `{"param": {"emailId": "XXXXX@corpository.com", "password": "Abc@12345678"}}` | `{"statusCode": 0, "data": null, "msg": "request key required"}` |
| `param` field missing | `{"request": "login"}` | `{"statusCode": 0, "data": null, "msg": "param key required"}` |
| Invalid User | `{"request": "login", "param": {"emailId": "YYYY@corpository.com", "password": "Abc@12345678"}}` | `{"statusCode": 0, "data": null, "msg": "You have entered an invalid email address or password. Please try again."}` |
| Invalid Password | `{"request": "login", "param": {"emailId": "YYYY@corpository.com", "password": "Abc@1234567890"}}` | `{"statusCode": 0, "data": null, "msg": "You have entered an invalid email address or password. Please try again."}` |

---

## Appendix-2: Order Creation Request Fields, Type, Description and Validation

| Field (Request Payload) | Mandatory | Field Type | Max Length | Format Validations | Description |
|-------------------------|-----------|------------|------------|--------------------|-------------|
| `"request"` | Y | Alpha only | — | `"create-order"` exact value | Request type — will be `"create-order"` for new order requests |
| `"lender_referenceNumber"` | Y | — | — | — | Tracking reference number as per Bank |
| `"lender_source"` | Y | Alpha only | — | `los` | Source of the order. Configured as `"los"`. Standard value, not to be changed |
| `"lender_name"` | Y | Alpha only | — | Standard configured value `"LenderName"` | Standard value, not to be changed |
| `"requestor_division"` | Y | Alpha only | — | Standard configured value `"Lender Division"` | Divisions not configured will return error |
| `"requestor_branch"` | Y | Alphanumeric | 200 | — | Name of the Branch / Location placing the order |
| `"requestor_name"` | Y | Alpha only | 200 | — | Name of the RM / Agent placing the order |
| `"requestor_email"` | Y | Alphanumeric | — | Standard email validation | Email of the RM / Agent placing the order (useful for communicating with the requestor, MIS reports) |
| `"requestor_phone"` | Y | Numeric | 10 | Standard phone number | Mobile number of the RM / Agent placing the order |
| `"borrower_name"` | Y | Alphanumeric | 200 | — | Name of the Applicant. Full name if Individual applicant or Entity name for non-Individual (Corporate) applicant |
| `"borrower_pan"` | N | Alphanumeric | 10 | Standard PAN validation | PAN of the applicant |
| `borrower_related_parties` | N | Section | — | — | Optional section to capture details of related parties. Used to identify related party transactions |
| `"bsaInfo"` | Y | Section | — | — | Section to share information about bank statement uploaded and analysis |
| `account_wise_sanction_limit` | N | Array | — | — | Section to specify sanction limits for bank statement accounts. Used for bank statement analysis |
| `bank_account_number` | Y* | Numeric | — | — | Field inside optional section `account_wise_sanction_limit`. Mandatory for each element provided |
| `sanction_limit` | Y* | Numeric | — | — | Field inside optional section `account_wise_sanction_limit`. Mandatory for each element provided |
| `month_wise_sanction_limit` | N | Section | — | — | Optional section to capture month-wise sanction limit for the account as applicable |
| `poa_from_date` | N | Date | — | `YYYY-MM` | From date for period of analysis requested |
| `poa_to_date` | N | Date | — | `YYYY-MM` | To date for period of analysis requested |
| `passwords` | N | Text | — | — | List of passwords if the files submitted are password protected. Order of passwords provided is not relevant |
| `"product_name"` | Y | Alpha only | — | Must be from given list of values | Identifies which products the order is for. Pass `"BSA"` for bank statement analysis |
| `"webhook_url"` | N | Alphanumeric | — | — | Client-provided webhook to return status of order progress |
| `"key_name"` | N | Alphanumeric | — | — | Key name of the webhook |
| `"key_value"` | N | Alphanumeric | — | — | Key value of the webhook |

> \* Mandatory within the optional section when that section is provided.

---

## Appendix-3: Failure Responses for Order Creation Requests

> **Note:** The below scenarios are indicative and not exhaustive. The response message will be descriptive enough to relate to the failure.

| Scenario | Error Response |
|----------|----------------|
| Invalid Security code (Auth token) | `{"statusCode": 0, "data": null, "msg": "User does not exists"}` |
| `client-security-token` missing | `{"statusCode": 3, "data": null, "msg": "user auth token is missing in headers"}` |
| `request` key missing | `{"statusCode": 0, "data": null, "msg": "request key required"}` |
| Incorrect `request` key | `{"statusCode": 0, "data": null, "msg": "Invalid request key"}` |
| Missing `lender_referenceNumber` | `{"statusCode": 0, "data": null, "msg": "Lender reference number not found"}` |
| Incorrect `lender_name` | `{"statusCode": 0, "data": null, "msg": "Invalid lender_name"}` |
| Incorrect `requestor_division` | `{"statusCode": 0, "data": null, "msg": "Invalid Requestor Division"}` |
| Missing `requestor_division` | `{"statusCode": 0, "data": null, "msg": "Requestor Division not found"}` |
| Missing `requestor_branch` | `{"statusCode": 0, "data": null, "msg": "Requestor Branch should not empty or null"}` |
| Missing `requestor_name` | `{"statusCode": 0, "data": null, "msg": "Requestor Name should not empty or null"}` |
| Missing `requestor_email` | `{"statusCode": 0, "data": null, "msg": "Requestor Email should not empty or null"}` |
| Invalid `requestor_email` | `{"statusCode": 0, "data": null, "msg": "Requestor Email not in the Expected Format"}` |
| Missing `requestor_phone` | `{"statusCode": 0, "data": null, "msg": "Requestor Phone should not empty or null"}` |
| Invalid `requestor_phone` | `{"statusCode": 0, "data": null, "msg": "Requestor Phone not in the Expected Format"}` |
| Missing `product_name` | `{"statusCode": 0, "data": null, "msg": "Product name not found"}` |
| Invalid `product_name` | `{"statusCode": 0, "data": null, "msg": "No Source System Found"}` |
| Any unresolved error | `{"statusCode": 0, "data": null, "msg": "Unexpected error occurred. Please contact Accumn CRM team"}` |

---

## Appendix-4: Fields Description for get-file-details Response

| # | Field Name | Description |
|---|------------|-------------|
| 1 | `"source"` | Source of the data. `ITR`: ITR portal. `GST`: GST portal. `BSA`: BSA upload |
| 2 | `"file_id"` | File ID |
| 3 | `"file_name"` | Name of the file |
| 4 | `"file_category"` | Category of file. `MRD`: Machine-readable data for the respective source. `REPORT`: Standard report for the respective source. `RAW`: Raw data collected from the respective source (e.g. files downloaded from the ITR portal). `CAM_REPORT`: Reports generated by combining data from multiple sources. `BP_UPLOAD`: Files uploaded by borrowers on the Consent Portal |
| 5 | `"mime_type"` | Mime type. `application/json`: JSON files. `application/xlsx`: Excel files. `application/pdf`: PDF files |
| 6 | `"file_size_in_bytes"` | Size of the file in bytes |
| 7 | `"download_url"` | URL for downloading the file |
| 8 | `"url_expiry_time_epoch_ms"` | Expiry time of the URL in milliseconds. Post elapse of this time, the URL is deactivated |
| 9 | `"key"` | Reference key. For BSA — PAN if provided |

---

## Appendix-5: Fields Description for Order Cancel Request

| # | Field Name | Description |
|---|------------|-------------|
| 1 | `"sourceSystem": 1` | Standard key-value to be sent as in the structure (Mandatory) |
| 2 | `"remark"` | Any remarks for cancellation (Not mandatory) |
| 3 | `"source"` | Source of the data (Mandatory). `ITR`: ITR portal. `GST`: GST portal. `BSA`: BSA Upload |

---

## Appendix-6: Failure Responses for Order Cancellation

| Scenario | Error Response |
|----------|----------------|
| Invalid `ffOrderId` | `{"statusCode": 0, "data": null, "msg": "Order details not found"}` |
| `ffOrderId` missing | `{"statusCode": 0, "data": null, "msg": "FF order id not found in request"}` |
| Request key missing | `{"statusCode": 0, "data": null, "msg": "request key required"}` |
| Attempting to cancel an already cancelled order | `{"statusCode": 1, "data": {"cancelledOrders": [], "notCancelledOrders": []}, "msg": "Order already cancelled"}` |

---

*© 2024 Accumn. All rights reserved.*
