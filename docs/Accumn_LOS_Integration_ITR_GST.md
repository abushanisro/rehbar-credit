# Accumn LOS Integration ITR & GST (Common LOS Platform)
## Integration Configuration Document V2.0

© 2024 Accumn. All rights reserved.

---

## Overview

This document provides generic details of the configuration settings for LOS (API) integration with Accumn Common LOS platform. The document includes generic details of requests, responses, and errors. Any specific implementation or customization will be supplemented with an annexure containing the details.

---

## Table of Contents

1. [Login and Access Token](#1-login-and-access-token)
   - [Request for Login and Access Token](#a-request-for-login-and-access-token)
   - [Success Response](#b-success-response)
   - [Failure Responses](#c-failure-responses)

2. [Create Order](#2-create-order)
   - [Request for Order Creation](#a-request-for-order-creation)
   - [Success Response for Order Creation](#b-success-for-order-creation)
   - [Duplicate Orders](#c-duplicate-orders)
   - [Failure Responses](#d-failure-responses)

3. [Link to Provide Consent](#3-link-to-provide-consent-to-initiate-download-of-itr-and-gst-data)

4. [Check Status](#4-check-status)
   - [Request for Order Status](#a-request-for-order-status)
   - [Success Response](#b-success-response-for-order-status)
   - [Failure Response](#c-failure-response-for-order-status)

5. [Push Order Status on Webhook](#5-push-order-status-on-webhook)

6. [Fetching Data, Files and Reports](#6-fetching-data-files-and-reports-get-file-details)
   - [Request for get-file-details](#a-request-for-get-file-details)
   - [Success Response](#b-success-response-for-get-file-details)
   - [Failure Response](#c-failure-response-for-get-file-details)

7. [Order Cancellation](#7-order-cancellation)
   - [Entire Order Cancellation](#a-request-and-success-response-for-order-cancel--entire-order)
   - [Partial Order Cancellation](#b-request-for-order-cancel--partial-order)
   - [Failure Response](#c-failure-response-for-order-cancel)

8. [Appendices](#appendices)

---

## 1. Login and Access Token

**Note:** An email id is required for creating the user against which the login credentials and authentication will be configured. An email id that will be monitored is suggested as it can also be repurposed for any automated notifications that need to be sent as needed.

### a) Request for Login and Access Token

**URL endpoints:**
- **UAT:** `https://dev-unicore-api.accumn.co/los/api/v1/api-details`
- **Production:** `https://unicore-api.accumn.ai/los/api/v1/api-details`

**Method:** POST

**Username:** user@domain.com  
**Password:** A***********8

**Request Body:**
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

**Note:** The auth token generated does not expire except in the event of a change in the password.

### c) Failure Responses

Failure scenarios and responses are provided in [Appendix-1](#appendix-1-failure-responses-for-login-and-access-token-requests)

---

## 2. Create Order

The Create Order API is used to create an order on the Accumn system for the process of downloading financial details from Income Tax and GST websites and provides for extraction of data to generate the necessary reports and analysis.

### a) Request for Order Creation

**URL endpoint:**
- **UAT:** `https://dev-unicore-api.accumn.co/los/api/v1/api-details`
- **Production:** `https://unicore-api.accumn.ai/los/api/v1/api-details`

**Method:** POST

**Headers:**
```
"client-security-token": "<Auth token received as a response of successful login>"
"content-type": "application/json"
```

**Request Body:**
```json
{
  "request": "create-order",
  "param": {
    "lenderInfo": {
      "lender_referenceNumber": "TestOrd2311656",
      "lender_source": "los",
      "lender_name": "LENDER NAME"
    },
    "requestorInfo": {
      "requestor_division": "LENDER DIVISION",
      "requestor_branch": "Branch name",
      "requestor_name": "Tester",
      "requestor_email": "tester@corpository.com",
      "requestor_phone": "9876543210"
    },
    "borrowerInfo": {
      "borrower_name": "Test Borrower",
      "borrower_DOIB": "22/02/1997",
      "borrower_pan": "TESTA1234A",
      "borrower_email": "customer@bank.com",
      "borrower_phone": "9876543211",
      "borrower_language": "English",
      "borrower_state": "Karnataka",
      "borrower_country": "India",
      "borrower_street": "Street",
      "borrower_city": "Bengaluru",
      "borrower_pincode": "560097",
      "borrower_additional_email": "customer2@bank.com",
      "borrower_additional_mobile": "9876543212",
      "borrower_additional_info": "additionalInfo",
      "borrower_cinLlpin": "cinLlpin"
    },
    "dataRelatedInfo": {
      "itrInfo": [
        "TESTA1234A"
      ],
      "gstInfo": [
        "24TESTA1234A1ZA",
        "14TESTA1234A1ZA"
      ]
    },
    "orderInfo": {
      "product_name": "GST, E-Financials(Self Employed Individuals), AD, BSA_AA",
      "assistanceBy": "CSR Assisted"
    },
    "otherInfo": {
      "send_consent_borrower": false,
      "redirect_url_success": "/BorrowerPortal/loginSucsess/FF-Order num",
      "redirect_url_fail": "/BorrowerPortal/loginFail/FF-Order num",
      "client_ref_details": "link"
    },
    "webhook_urls": [
      {
        "webhook_url": "https://domain.com/1.0/webhook_report/token/value",
        "key_name": "webhook_token",
        "key_value": "webhook_value"
      }
    ]
  }
}
```

**Note:** Field descriptions, validations (Mandatory/Optional, field length, validations of values passed, etc.) are provided in [Appendix-2](#appendix-2-order-creation-request-fields-type-description-and-validation)

### b) Success for Order Creation

On receipt of the request, the Accumn system responds synchronously with a Success or Error Response. Below are the configured responses:

```json
{
  "statusCode": 1,
  "data": {
    "ffOrderId": "FU24120112345",
    "consent_link": "https://test-consent.corpository.com/consent/login/FU16468ee1-67f6-46cd-9572-fca50828abfa"
  },
  "msg": "Order created successfully"
}
```

### c) Duplicate Orders

Duplicate orders are identified if the following fields match an order that has already been created in the last 10 minutes. In case of a duplicate order request being identified, the requested order is not created and instead a message communicating the same is returned.

**Fields used for Duplicate Order Comparison:**
1. borrowerInfo - borrower_pan
2. orderInfo - product_name
3. lenderInfo - lender_referenceNumber
4. borrowerInfo - borrower_phone
5. lenderInfo - lender_name
6. requestorInfo - requestor_branch
7. requestorInfo - requestor_division

### d) Failure Responses

On errors due to validation, an error response is returned, and the order is not created. Refer to [Appendix-3](#appendix-3-failure-responses-for-order-creation-requests) for the failure scenarios and corresponding error messages.

---

## 3. Link to Provide Consent to Initiate Download of ITR and GST Data

On successful creation of the order, the applicant gets intimated with an invite to initiate the process of downloading the data from the ITR and GST websites. Depending on the integration, the invite to initiate the download is sent to the applicant in the following ways:

### a) Download Link Sent on Email and SMS

The link for the applicant to provide consent and progress to the download is sent via email and SMS on the email addresses and mobile numbers provided during Order Creation. The applicant is directed to click on the link provided in the communication to provide consent for the download and progress further.

Sample email and SMS provided in [Appendix-4](#appendix-4-sample-email-and-sms-sent-to-customer-for-consent-journey)

### b) Download Link in Order Creation Response

On successful Order creation, the success response contains the link to initiate the consent for download and progress further. This link can be displayed as needed on the lender system's applications or portal. This is a preferred option for DIY or applicant completing the downloads on the lender system.

```json
{
  "statusCode": 1,
  "data": {
    "ffOrderId": "FU24120112345",
    "consent_link": "https://test-consent.corpository.com/consent/login/FU16468ee1-67f6-46cd-9572-fca50828abfa"
  },
  "msg": "Order created successfully"
}
```

---

## 4. Check Status

The Check Status API provides the ability to check for the download and delivery status of ITR and GST requests. On successful consent, the applicant is logged out of the consent portal and the downloads, extraction of data, and report generation happen in the background. This API provides the status of the same.

### a) Request for Order Status

**URL endpoints:**
- **UAT:** `https://dev-unicore-api.accumn.co/los/api/v1/api-details`
- **Production:** `https://unicore-api.accumn.ai/los/api/v1/api-details`

**Method:** POST

**Headers:**
```
"client-security-token": "<Auth token received as a response of successful login>"
```

**Request Body:**
```json
{
  "request": "check-order-status",
  "param": {
    "ffOrderId": "FU24120112345"
  }
}
```

**Note:** ffOrderId is a mandatory field to be passed

### b) Success Response for Order Status

Provides the current status of the ITR and GST requests:

```json
{
  "statusCode": 1,
  "data": {
    "ffOrderId": "FU24120112345",
    "lender_referenceNumber": "TestOrd2311656",
    "order_status": "Pending",
    "order_details": [
      {
        "source": "GST",
        "order_status": "Completed",
        "key": "24TESTA1234A1ZC"
      },
      {
        "source": "GST",
        "order_status": "Cancelled",
        "key": "14TESTA1234A1ZC"
      },
      {
        "source": "ITR",
        "order_status": "Pending",
        "key": "TESTA1234A"
      }
    ]
  },
  "msg": "Success"
}
```

### c) Failure Response for Order Status

| Scenario | Error Response |
|----------|---|
| Invalid ffOrderId | `{"statusCode": 0, "data": null, "msg": "Order Not Found"}` |
| ffOrderId missing | `{"statusCode": 0, "data": null, "msg": "FF order id not found"}` |
| Invalid value in request | `{"statusCode": 0, "data": null, "msg": "Invalid request key"}` |

---

## 5. Push Order Status on Webhook

The status of the order can be pushed on the webhook provided by the client. This allows an alternate option to be updated on the order status on the client-hosted webhook. The webhook details on which the order status needs to be pushed must be provided during order creation using the following keys:

```json
"webhook_urls": [
  {
    "webhook_url": "https://domain.com/1.0/webhook_report/token/value",
    "key_name": "webhook_token",
    "key_value": "webhook_value"
  }
]
```

**Note:** This feature needs to be enabled during the integration by configuration. By default, this feature is not enabled.

On completion of the order (or cancellation), the status of the order is sent on the webhook provided in the following structure:

```json
{
  "statusCode": 1,
  "data": {
    "ffOrderId": "FU24120112345",
    "lender_referenceNumber": "TestOrd2311656",
    "order_status": "Pending",
    "order_details": [
      {
        "source": "GST",
        "order_status": "Completed",
        "key": "24TESTA1234A1ZC"
      },
      {
        "source": "GST",
        "order_status": "Cancelled",
        "key": "14TESTA1234A1ZC"
      },
      {
        "source": "ITR",
        "order_status": "Pending",
        "key": "TESTA1234A"
      }
    ]
  },
  "msg": "Success"
}
```

**Important Notes:**
- A success response on receipt of the above request is expected to be returned from the client to acknowledge the receipt of the status
- In the event of delivery failure due to unavailability of the receiving systems, the request will be reattempted at regular intervals
- Any failure scenarios apart from the unavailability of receiving systems should be discussed for implementation

---

## 6. Fetching Data, Files and Reports (get-file-details)

On completion of the downloads, the downloaded files, reports, and machine-readable data are made available for fetching by calling the API below.

### Available Files:
- **ITR files:** ITR forms, Acknowledgment of filing, Form26AS, AIS/TIS files, Financials (PL, BS, and audit report) as filed
- **GST files:** GST data and filing details
- **Machine-readable data:** Standard PL and BS data or income data depending on the type of ITR filed by the applicant, sent as a JSON file. GAT data and filing details sent as a JSON file
- **Reports:** CAM (MS-Excel file) and standard PDF report based on the product requested

**Notes:**
- Number of Financial Years for downloading and extraction of data is configured for the latest 3 years of filing from the current FY
- CAM and Machine-Readable Data is a standard offering and can be customized if needed
- **Important:** Check the status of the order before fetching the files. There would be partial or no files available if the download is still in progress or delayed due to issues at the data source

### a) Request for get-file-details

**URL endpoints:**
- **UAT:** `https://dev-unicore-api.accumn.co/los/api/v1/api-details`
- **Production:** `https://unicore-api.accumn.ai/los/api/v1/api-details`

**Headers:**
```
"client-security-token": "<Auth token received as a response of successful login>"
```

**Request Body:**
```json
{
  "request": "get-file-details",
  "param": {
    "ffOrderId": "FU24120112345",
    "incremental": false
  }
}
```

**Note:** ffOrderId is a mandatory field

**Incremental Parameter:**
- If `incremental` is `false`: All files available for the order at the point of time requested are downloaded. By default, this is set to false
- If `incremental` is `true`: Only files that were not downloaded on an earlier attempt will be downloaded (already downloaded files will be skipped)

### b) Success Response for get-file-details

```json
{
  "statusCode": 1,
  "msg": "get file details api called successfully",
  "data": {
    "file_details": [
      {
        "source": "ITR",
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
        "source": "ITR",
        "file_id": 40678,
        "file_name": "FU24120112345_FF_CAM.xlsx",
        "file_category": "REPORT",
        "mime_type": "application/xlsx",
        "file_size_in_bytes": 51368,
        "download_url": "https://ufw-ff-corp-uat.s3.ap-south-1.amazonaws.com",
        "url_expiry_time_epoch_ms": 1733898233127,
        "key": "TESTA1234A"
      },
      {
        "source": "ITR",
        "file_id": 41107,
        "file_name": "MRD_FU24120112345_QE_Uni_ITR.json",
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

Field descriptions for the response are provided in [Appendix-5](#appendix-5-fields-description-for-get-file-details-response)

### c) Failure Response for get-file-details

| Scenario | Error Response |
|----------|---|
| Wrong ffOrderId | `{"statusCode": 0, "data": null, "msg": "File details not found for :FU24120300938"}` |
| Missing ffOrderId | `{"statusCode": 0, "data": null, "msg": "ffOrderId is Null or empty"}` |
| Invalid request | `{"statusCode": 0, "data": null, "msg": "Invalid request key"}` |

---

## 7. Order Cancellation

Order cancellation can be requested by sending the order details on the below API. Note that the order can be cancelled only up to a certain point of time post order creation. The process for cancellation and the point of time until when it can be considered must be discussed ahead of the integration with the SPoCs of Accumn.

In case of ITR + GST order, the entire order can be cancelled or a partial order can be cancelled.

### a) Request and Success Response for Order Cancel – Entire Order

Request to cancel both ITR and GST (in an ITR + GST order):

**Request:**
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
        "source": "GST",
        "key": "24TESTA1234A1ZC",
        "status": "Cancelled"
      },
      {
        "source": "GST",
        "key": "14TESTA1234A1ZG",
        "status": "Cancelled"
      },
      {
        "source": "ITR",
        "key": "TESTA1234A",
        "status": "Cancelled"
      }
    ],
    "notCancelledOrders": []
  },
  "msg": "Order cancellation successfully"
}
```

### b) Request for Order Cancel – Partial Order

#### Cancel only ITR (in an ITR + GST order)

**Request:**
```json
{
  "request": "cancel-order",
  "sourceSystem": 1,
  "param": {
    "ffOrderId": "FU24120112345",
    "remark": "",
    "order_details": [
      {
        "source": "ITR",
        "key": "TEST1234A"
      }
    ]
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
        "source": "ITR",
        "key": "TEST1234A",
        "status": "Cancelled"
      }
    ],
    "notCancelledOrders": [
      {
        "source": "GST",
        "key": "24TEST1234A1ZC",
        "status": "Pending"
      },
      {
        "source": "GST",
        "key": "14TEST1234A1ZC",
        "status": "Report Ready"
      }
    ]
  },
  "msg": "Order cancellation successfully"
}
```

#### Cancel only one GSTIN (in an ITR + GST order)

**Request:**
```json
{
  "request": "cancel-order",
  "sourceSystem": 1,
  "param": {
    "ffOrderId": "FU24120112345",
    "remark": "",
    "order_details": [
      {
        "source": "GST",
        "key": "24TEST1234A1ZC"
      }
    ]
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
        "source": "GST",
        "key": "24TEST1234A1ZC",
        "status": "Cancelled"
      }
    ],
    "notCancelledOrders": [
      {
        "source": "ITR",
        "key": "TEST1234A",
        "status": "Pending"
      },
      {
        "source": "GST",
        "key": "14TEST1234A1ZC",
        "status": "Report Ready"
      }
    ]
  },
  "msg": "Order cancellation successfully"
}
```

Fields description for Order Cancel request is provided in [Appendix-6](#appendix-6-fields-description-for-order-cancel-request)

### c) Failure Response for Order Cancel

List of scenarios and failure responses are provided in [Appendix-7](#appendix-7-failure-responses-for-order-cancellation)

---

## Appendices

---

## Appendix-1: Failure Responses for Login and Access Token Requests

| Scenario | Invalid Request | Error Response |
|----------|---|---|
| Invalid User | `{"request": "login", "param": {"emailId": "abc.xyz ", "password": "Corpository123"}}` | `{"statusCode": 0, "data": null, "msg": "user does not exists"}` |
| Invalid request field | `{"request": "xyz", "param": {"emailId": "XXXXX@corpository.com", "password": "Abc@12345678"}}` | `{"statusCode": 0, "data": null, "msg": "Invalid request key"}` |
| Request field missing | `{"param": {"emailId": "XXXXX@corpository.com", "password": "Abc@12345678"}}` | `{"statusCode": 0, "data": null, "msg": "request key required"}` |
| param field missing | `{"request": "login"}` | `{"statusCode": 0, "data": null, "msg": "param key required"}` |
| Invalid User | `{"request": "login", "param": {"emailId": "YYYY@corpository.com", "password": "Abc@12345678"}}` | `{"statusCode": 0, "data": null, "msg": "You have entered an invalid email address or password. Please try again."}` |
| Invalid Password | `{"request": "login", "param": {"emailId": "YYYY@corpository.com", "password": "Abc@1234567890"}}` | `{"statusCode": 0, "data": null, "msg": "You have entered an invalid email address or password. Please try again."}` |

---

## Appendix-2: Order Creation Request Fields Type, Description, and Validation

| # | Field (Request Payload) | Mandatory | Field Type | Max Length | Format Validations | Description |
|---|---|---|---|---|---|---|
| 1 | request | Y | Alpha only | N/A | "create-order" | Request type – Will be "create-order" for new order requests |
| 2 | lender_referenceNumber | Y | Alphanumeric | - | - | Tracking reference number as per Bank |
| 3 | lender_source | Y | Alpha only | - | "los" | Source of the order. Configured as "los". Standard value not to be changed |
| 4 | lender_name | Y | Alpha only | - | Standard configured value | "LenderName" - Standard value not to be changed |
| 5 | requestor_division | Y | Alpha only | - | Standard configured value | "Lender Division" - Divisions not configured will return error |
| 6 | requestor_branch | Y | Alphanumeric | 200 | - | Name of the Branch/Location placing the order |
| 7 | requestor_name | Y | Alpha only | 200 | - | Name of the RM/Agent placing the order |
| 8 | requestor_email | Y | Alphanumeric | - | Standard email validation | Email of the RM/Agent placing the order (useful for communicating with the requestor, MIS reports) |
| 9 | requestor_phone | Y | Numeric | 10 | Standard phone number | Mobile number of the RM/Agent placing the order (useful for communicating with the requestor, MIS reports) |
| 10 | borrower_name | Y | Alphanumeric | 200 | - | Name of the Applicant. Full name if Individual applicant or the Entity name in case of non-Individual (Corporate) applicant |
| 11 | borrower_DOIB | Y | Date | - | DD/MM/YYYY | Date of birth (if order is for an Individual) / Date of Incorporation (in case of entity) in format DD/MM/YYYY |
| 12 | borrower_pan | Y | Alphanumeric | 10 | Standard PAN validation | PAN of the applicant |
| 13 | borrower_email | Y | Alphanumeric | - | Standard email validation | Email of the applicant to receive the welcome email with link to initiate download |
| 14 | borrower_phone | Y | Numeric | 10 | Standard phone number validation | Mobile number of the applicant to receive the link on SMS to initiate the download |
| 15 | borrower_language | Y | Alpha only | - | Should be from given list of values | Preferred language of communication with the Call center agent. If not provided, English will be the default |
| 16 | borrower_state | N | Alpha only | - | - | Applicant's Address - State |
| 17 | borrower_country | N | Alpha only | - | - | Applicant's Address – by Default India |
| 18 | borrower_street | N | Alphanumeric | - | - | Applicant's Address - Street and Locality |
| 19 | borrower_city | N | Alphanumeric | - | - | Applicant's Address – City |
| 20 | borrower_pincode | N | Numeric | 6 | - | Applicant's Address - PIN |
| 21 | borrower_additional_email | N | Alphanumeric | - | Standard email validation | Additional email of the Applicant to receive a copy of the welcome email with link |
| 22 | borrower_additional_mobile | N | Numeric | 10 | Standard phone number validation | Alternate mobile number of the applicant to receive the link to initiate the download |
| 23 | borrower_additional_info | N | Alphanumeric | - | - | Free field for providing any additional information. Discuss with Accumn SPoC as needed |
| 24 | borrower_cinLlpin | N | Alphanumeric | - | - | CIN or LLPIN of the Applicant (Applicable for non-individual applicants) |
| 25 | itrInfo | Y/N | Alphanumeric | 10 | If Order for ITR service then this field is mandatory. It is same as "borrower_pan" | PAN of the applicant for ITR service request |
| 26 | gstInfo | Y/N | Alphanumeric | - | If Order for GST service then this field is mandatory. GSTINs validated against "borrower_pan" | GSTINs of the applicant. This is an array and multiple GSTINs can be sent. Ensure GSTIN is valid and related to the PAN |
| 29 | product_name | Y | String | - | Should be from given list of values | Comma separated list to identify products for which the order has to be placed |
| 30 | assistanceBy | Y | Alpha only | - | "Lender Assisted" or "CSR Assisted" | CSR Assisted indicates Call center assistance for the download. Lender Assisted will not involve the call centre support |
| 31 | send_consent_borrower | Y | true/false | - | Standard values | true - will send email and SMS with download link to customer; false - will not send link to customer |
| 32 | redirect_url_success | N | Alphanumeric | - | - | URL/link provided by the lender to which the applicant will be redirected to on consent and successful login to IT portal |
| 33 | redirect_url_fail | N | Alphanumeric | - | - | URL/link provided by the lender to which the applicant will be redirected to on consent not provided by the applicant or failed login to IT portal |
| 34 | client_ref_details | N | Alphanumeric | - | - | Custom field for lender to send any lender references which may be useful for lender to configure their systems |
| 35 | webhook_url | N | Alphanumeric | - | - | Client provided Webhook to return status of order progress. This is configurable as needed by the lender if updates on the progress of the order is needed |
| 36 | key_name | N | Alphanumeric | - | - | Key Name of the webhook |
| 37 | key_value | N | Alphanumeric | - | - | Key value of the webhook |

### Configured Languages:
1. Hindi
2. Gujarati
3. English
4. Marathi
5. Tamil
6. Telugu
7. Punjabi
8. Malayalam
9. Oriya
10. Kannada
11. Bengali
12. Assamese

### Configured Product Names:

**ITR Service:**
- E-Financials(Salaried Individuals)
- E-Financials(Self Employed Individuals)
- E-Financials(Corporate)

**GST Service:**
- GST

---

## Appendix-3: Failure Responses for Order Creation Requests

**Note:** The below scenarios are indicative and not exhaustive. The response message will be descriptive enough to relate to the failure.

| Scenario | Error Response |
|---|---|
| Duplicate Order | `{"statusCode": 2, "data": {"ffOrderId": "FU24112800044"}, "msg": "Duplicate Order"}` |
| Invalid Security code (Auth token) | `{"statusCode": 0, "data": null, "msg": "User does not exists"}` |
| client-security-token missing | `{"statusCode": 3, "data": null, "msg": "user auth token is missing in headers"}` |
| request key Missing | `{"statusCode": 0, "data": null, "msg": "request key required"}` |
| Incorrect request key | `{"statusCode": 0, "data": null, "msg": "Invalid request key"}` |
| Missing lender_referenceNumber | `{"statusCode": 0, "data": null, "msg": "Lender reference number not found"}` |
| Incorrect lender_name | `{"statusCode": 0, "data": null, "msg": "Invalid lender_name"}` |
| Incorrect requestor_division | `{"statusCode": 0, "data": null, "msg": "Invalid Requestor Division"}` |
| Missing requestor_division | `{"statusCode": 0, "data": null, "msg": "Requestor Division not found"}` |
| Missing requestor_branch | `{"statusCode": 0, "data": null, "msg": "Requestor Branch should not empty or null"}` |
| Missing requestor_name | `{"statusCode": 0, "data": null, "msg": "Requestor Name should not empty or null"}` |
| Missing requestor_email | `{"statusCode": 0, "data": null, "msg": "Requestor Email should not empty or null"}` |
| Invalid requestor_email | `{"statusCode": 0, "data": null, "msg": "Requestor Email not in the Expected Format"}` |
| Missing requestor_phone | `{"statusCode": 0, "data": null, "msg": "Requestor Phone should not empty or null"}` |
| Invalid requestor_phone | `{"statusCode": 0, "data": null, "msg": "Requestor Phone not in the Expected Format"}` |
| Missing borrower_name | `{"statusCode": 0, "data": null, "msg": "Borrower Name should not empty or null"}` |
| Missing borrower_DOIB | `{"statusCode": 0, "data": null, "msg": "Borrower DOIB should not empty or null"}` |
| Invalid borrower_DOIB / borrower_DOIB greater than current date | `{"statusCode": 0, "data": null, "msg": "DOIB Is greater than expected , DOIB is expected in DD/MM/YYYY"}` |
| Missing borrower_pan | `{"statusCode": 0, "data": null, "msg": "Borrower PAN should not empty or null"}` |
| Invalid borrower_pan | `{"statusCode": 0, "data": null, "msg": "Borrower PAN not in the Expected Format"}` |
| Missing borrower_email | `{"statusCode": 0, "data": null, "msg": "Borrower Email should not empty or null"}` |
| Invalid borrower_email | `{"statusCode": 0, "data": null, "msg": "Borrower Email not in the Expected Format"}` |
| Missing borrower_phone | `{"statusCode": 0, "data": null, "msg": "Borrower Phone should not empty or null"}` |
| Invalid borrower_phone | `{"statusCode": 0, "data": null, "msg": "Borrower Phone not in the Expected Format"}` |
| Missing borrower_language | `{"statusCode": 0, "data": null, "msg": "Borrower Language should not empty or null"}` |
| Invalid borrower_additional_email | `{"statusCode": 0, "data": null, "msg": "Borrower Additional Email not in the Expected Format"}` |
| Invalid borrower_additional_mobile | `{"statusCode": 0, "data": null, "msg": "Borrower Additional Mobile not in the Expected Format"}` |
| borrower_pan and itrInfo Mismatch / missing value in itrInfo | `{"statusCode": 0, "data": null, "msg": "Borrower PAN and ITR Info PAN not Matched"}` |
| Missing GSTIN in gstInfo (for GST orders) | `{"statusCode": 0, "data": null, "msg": "GST Info should not empty or null"}` |
| Invalid GSTIN in gstInfo (not matching with PAN, invalid format) | `{"statusCode": 0, "data": null, "msg": "Invalid GSTIN Number in gstInfo"}` |
| Missing product_name | `{"statusCode": 0, "data": null, "msg": "Product name not found"}` |
| Invalid product_name | `{"statusCode": 0, "data": null, "msg": "No Source System Found"}` |
| Any unresolved error | `{"statusCode": 0, "data": null, "msg": "Unexpected error occurred. Please contact Accumn CRM team"}` |

---

## Appendix-4: Sample Email and SMS Sent to Customer for Consent Journey

### Sample Email

**Header:** CORPOSITORY – A Yubi Company

---

**To:** Mr. / Ms. Test Borrower

**Mobile:** 9980525574

**Additional Mobile:** [blank]

**Email:** paradhya@finfort.ind.in

**Additional Email:** [blank]

---

**Ref:** Your Loan Application / Loan Reference Number **TestOrd2311656** with (Lentra)-(Lentra) - Corpository Order Number: **FU24120300023**

Further to the intimation by Lentra & Lentra of Corpository having been appointed to conduct a credit evaluation of your financial commitment towards:

- Income Tax / Form26AS
- GST

**[GIVE CONSENT BUTTON]**

---

We are appending the link to our Consent Portal to enable you to log into the Income Tax website (http://incometaxindiaefiling.gov.in) and GST website (https://services.gst.gov.in/services/login) which ever is applicable, to download the documents. Corpository customer support representative (CSR) will contact you to provide telephonic support to log into the Consent Portal and the Income Tax/GST website. We request you to keep PAN and your Income Tax/GST login credentials ready prior to the data download session.

The list of recommended browsers is as follows:

- Google Chrome - version 50 and above
- Mozilla Firefox - version 48 and above
- Internet Explorer - version 10 and above
- Safari - version 10

If you want Your representative (CA / Lawyer etc.) to access the Consent Portal on your behalf and download the documents, please forward the link and password in this email to Your representative. By sharing the link and password, you are authorizing them to accept the Terms and Conditions on your behalf and complete the download.

If you require any clarifications or support, you may reach Corpository CSR at support@corpository.com or the customer service numbers 080-69260809. Please quote your Corpository order number given above in your correspondence.

**Corpository CSR will NOT ask for the login credentials for the Consent Portal or Income Tax website and you are requested Not to Share the same on phone or on email.**

You are requested to complete the download within 6 hours of receiving this email. Early completion of the download shall facilitate faster processing of your loan application.

---

**Kind regards,**
Customer Support

---

### Sample SMS

Loan Appln 123456 with New Bank. click the link to login https://tinyurl.com/25f00j3e  
PW:12345

---

## Appendix-5: Fields Description for get-file-details Response

| # | Field Name | Description |
|---|---|---|
| 1 | source | Source of the data: ITR (ITR portal) or GST (GST portal) |
| 2 | file_id | File ID |
| 3 | file_name | Name of the file |
| 4 | file_category | Category of file: MRD (Machine-readable data for the respective source), REPORT (Standard report for the respective source), RAW (Raw data collected from the respective source, such as files downloaded from the ITR portal), CAM_REPORT (Reports generated by combining data from multiple sources), BP_UPLOAD (Files uploaded by borrowers on the Consent Portal) |
| 5 | mime_type | Mime type: application/json (For JSON file types), application/xlsx (For Excel file types), application/pdf (For PDF file types) |
| 6 | file_size_in_bytes | Size of the file in bytes |
| 7 | download_url | URL for downloading the file |
| 8 | url_expiry_time_epoch_ms | Expiry time of the URL in milliseconds. Post elapse of this time, the URL is deactivated |
| 9 | key | Reference key: For ITR related files, it will be the PAN; For GST related files, it will be the GSTIN |

---

## Appendix-6: Fields Description for Order Cancel Request

| # | Field Name | Description |
|---|---|---|
| 1 | sourceSystem | Standard key-value to be sent as in the structure (Mandatory) |
| 2 | remark | Any remarks for cancellation (Not mandatory) |
| 3 | source | Source of the data (Mandatory): ITR (ITR portal) or GST (GST portal) |
| 4 | key | Reference key (Mandatory): For ITR related files, it will be the PAN; For GST related files, it will be the GSTIN |

---

## Appendix-7: Failure Responses for Order Cancellation

| Scenario | Error Response |
|---|---|
| Invalid ffOrderId | `{"statusCode": 0, "data": null, "msg": "Order details not found"}` |
| ffOrderId missing | `{"statusCode": 0, "data": null, "msg": "FF order id not found in request"}` |
| Request key missing | `{"statusCode": 0, "data": null, "msg": "request key required"}` |
| Attempting to cancel an already cancelled order (entire order) | `{"statusCode": 1, "data": {"cancelledOrders": [], "notCancelledOrders": []}, "msg": "Order already cancelled"}` |
| Attempting to cancel an already cancelled order (GSTIN order already cancelled) | `{"statusCode": 1, "data": {"cancelledOrders": [{"source": "GST", "key": "24TEST1234A1ZC", "status": "Cancelled"}], "notCancelledOrders": [{"source": "ITR", "key": "TEST1234A", "status": "Pending"}, {"source": "GST", "key": "14TEST1234A1ZC", "status": "Report Ready"}]}, "msg": "Order already cancelled"}` |

---

## Document Information

**Document Version:** 2.0  
**Last Updated:** 2024  
**Copyright:** © 2024 Accumn. All rights reserved.

---

*This document provides the standard configuration and API specifications for Accumn LOS integration. For any specific implementations or customizations, please contact Accumn support.*
