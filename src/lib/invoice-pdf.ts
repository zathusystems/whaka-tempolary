import { Invoice } from '@/lib/db';

/**
 * Generate PDF content for an invoice with two copies (one for customer, one for business)
 * with spaces for stamps and signatures
 */
export async function generateInvoicePDF(invoice: Invoice, businessName: string, businessAddress: string) {
  // Dynamically import html2pdf to avoid SSR issues
  const html2pdfModule = await import('html2pdf.js');
  const html2pdf = ((html2pdfModule as any).default ?? html2pdfModule) as any;

  const generateInvoiceCopy = (copyType: 'customer' | 'business') => `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Invoice #${invoice.invoiceNumber}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Arial', sans-serif;
          color: #333;
          line-height: 1.6;
        }
        
        .container {
          max-width: 8.5in;
          height: 11in;
          margin: 0 auto;
          padding: 0.5in;
          background: white;
          display: flex;
          flex-direction: column;
        }
        
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.3in;
          border-bottom: 2px solid #000;
          padding-bottom: 0.2in;
        }
        
        .company-info h1 {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 0.1in;
        }
        
        .company-info p {
          font-size: 11px;
          margin: 2px 0;
        }
        
        .invoice-title {
          text-align: right;
        }
        
        .invoice-title h2 {
          font-size: 28px;
          font-weight: bold;
          color: #2c3e50;
          margin-bottom: 0.1in;
        }
        
        .invoice-number {
          font-size: 12px;
          font-weight: bold;
          margin-bottom: 0.05in;
        }
        
        .invoice-date {
          font-size: 11px;
          color: #666;
        }
        
        .content {
          display: flex;
          gap: 0.3in;
          margin-bottom: 0.2in;
          flex: 1;
        }
        
        .bill-to, .bill-from {
          flex: 1;
        }
        
        .bill-to h3, .bill-from h3 {
          font-size: 12px;
          font-weight: bold;
          margin-bottom: 0.1in;
          text-transform: uppercase;
          border-bottom: 1px solid #ddd;
          padding-bottom: 0.05in;
        }
        
        .bill-to p, .bill-from p {
          font-size: 11px;
          margin: 3px 0;
        }
        
        .items-section {
          margin-bottom: 0.2in;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          margin-bottom: 0.1in;
        }
        
        thead {
          background-color: #f5f5f5;
          border-top: 2px solid #000;
          border-bottom: 2px solid #000;
        }
        
        th {
          padding: 0.1in;
          text-align: left;
          font-weight: bold;
          font-size: 11px;
        }
        
        td {
          padding: 0.08in 0.1in;
          border-bottom: 1px solid #eee;
        }
        
        .qty, .price, .total {
          text-align: right;
        }
        
        tbody tr:last-child td {
          border-bottom: 2px solid #000;
        }
        
        .summary {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 0.2in;
        }
        
        .summary-box {
          width: 2.5in;
        }
        
        .summary-row {
          display: flex;
          justify-content: space-between;
          padding: 0.05in 0.1in;
          font-size: 11px;
          border-bottom: 1px solid #ddd;
        }
        
        .summary-row.total {
          border-top: 2px solid #000;
          border-bottom: 2px solid #000;
          font-weight: bold;
          font-size: 13px;
          padding: 0.1in;
        }
        
        .notes-section {
          margin-bottom: 0.2in;
          font-size: 10px;
        }
        
        .notes-section h4 {
          font-weight: bold;
          margin-bottom: 0.05in;
          font-size: 11px;
        }
        
        .notes-section p {
          margin: 0;
          color: #666;
        }
        
        .signatures {
          display: flex;
          justify-content: space-between;
          margin-top: auto;
          padding-top: 0.2in;
          border-top: 1px solid #ddd;
        }
        
        .signature-block {
          flex: 1;
          text-align: center;
          font-size: 10px;
        }
        
        .signature-line {
          border-top: 1px solid #000;
          margin-top: 0.4in;
          margin-bottom: 0.05in;
          min-height: 0.6in;
        }
        
        .signature-label {
          font-weight: bold;
          margin-top: 0.05in;
        }
        
        .stamp-area {
          flex: 1;
          border: 2px dashed #999;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #999;
          font-size: 12px;
          font-weight: bold;
          text-align: center;
          padding: 0.2in;
          margin: 0 0.1in;
        }
        
        .footer {
          text-align: center;
          font-size: 9px;
          color: #999;
          margin-top: 0.1in;
          padding-top: 0.1in;
          border-top: 1px solid #ddd;
        }
        
        @media print {
          body {
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 100%;
            height: 100%;
            padding: 0.5in;
            margin: 0;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- Header -->
        <div class="header">
          <div class="company-info">
            <h1>${businessName}</h1>
            <p>${businessAddress}</p>
          </div>
          <div class="invoice-title">
            <h2>INVOICE</h2>
            <div class="invoice-number">Invoice #${invoice.invoiceNumber}</div>
            <div class="invoice-date">Date: ${new Date(invoice.issueDate).toLocaleDateString()}</div>
            <div class="invoice-date">Due: ${new Date(invoice.dueDate).toLocaleDateString()}</div>
          </div>
        </div>
        
        <!-- Bill To / From -->
        <div class="content">
          <div class="bill-to">
            <h3>Bill To:</h3>
            <p><strong>${invoice.customerName}</strong></p>
          </div>
          <div class="bill-from">
            <h3>Invoice Details:</h3>
            <p><strong>Status:</strong> ${invoice.status}</p>
            <p><strong>Payment Method:</strong> On Account</p>
          </div>
        </div>
        
        <!-- Items Table -->
        <div class="items-section">
          <table>
            <thead>
              <tr>
                <th style="width: 50%;">Description</th>
                <th style="width: 15%;" class="qty">Qty</th>
                <th style="width: 17.5%;" class="price">Unit Price</th>
                <th style="width: 17.5%;" class="total">Total</th>
              </tr>
            </thead>
            <tbody>
              ${invoice.items.map(item => `
                <tr>
                  <td>${item.name}</td>
                  <td class="qty">${item.quantity}</td>
                  <td class="price">$${(item.price).toFixed(2)}</td>
                  <td class="total">$${(item.total).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        
        <!-- Summary -->
        <div class="summary">
          <div class="summary-box">
            <div class="summary-row">
              <span>Subtotal:</span>
              <span>$${invoice.subtotal.toFixed(2)}</span>
            </div>
            <div class="summary-row">
              <span>Tax:</span>
              <span>$${invoice.tax.toFixed(2)}</span>
            </div>
            <div class="summary-row total">
              <span>Total Due:</span>
              <span>$${invoice.total.toFixed(2)}</span>
            </div>
          </div>
        </div>
        
        <!-- Notes -->
        ${invoice.notes ? `
          <div class="notes-section">
            <h4>Notes:</h4>
            <p>${invoice.notes}</p>
          </div>
        ` : ''}
        
        <!-- Signatures and Stamp -->
        <div class="signatures">
          <div class="signature-block">
            <div class="signature-line"></div>
            <div class="signature-label">Authorized Signature</div>
          </div>
          <div class="stamp-area">
            STAMP / SEAL
          </div>
          <div class="signature-block">
            <div class="signature-line"></div>
            <div class="signature-label">Customer Signature</div>
          </div>
        </div>
        
        <!-- Footer -->
        <div class="footer">
          <p>Thank you for your business!</p>
          <p>This is an official invoice. Please retain for your records.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Create container for both copies
  const container = document.createElement('div');
  
  // Generate customer copy
  const customerCopyHTML = generateInvoiceCopy('customer');
  const customerCopyDiv = document.createElement('div');
  customerCopyDiv.innerHTML = customerCopyHTML;
  container.appendChild(customerCopyDiv);
  
  // Add page break
  const pageBreak = document.createElement('div');
  pageBreak.style.pageBreakAfter = 'always';
  pageBreak.style.height = '0';
  container.appendChild(pageBreak);
  
  // Generate business copy
  const businessCopyHTML = generateInvoiceCopy('business');
  const businessCopyDiv = document.createElement('div');
  businessCopyDiv.innerHTML = businessCopyHTML;
  container.appendChild(businessCopyDiv);

  const options = {
    margin: 0,
    filename: `Invoice_${invoice.invoiceNumber}_Copies.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
  };

  return html2pdf().set(options).from(container).save();
}
