'use client';

import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, Eye, Smartphone, QrCode as QrCodeIcon, FileImage, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface QRTemplate {
  id: string;
  name: string;
  description: string;
  size: 'small' | 'medium' | 'large';
  style: 'minimal' | 'modern' | 'elegant' | 'colorful';
  features: string[];
}

const generateQRDesignHTML = (
  qrCodeUrl: string,
  businessName: string,
  template: QRTemplate
): string => {
  const designs: Record<string, string> = {
    minimal: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Menu QR Code</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #f5f5f5;
            padding: 20px;
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
            width: 100%;
          }
          h1 {
            font-size: 28px;
            margin-bottom: 10px;
            color: #333;
          }
          .subtitle {
            font-size: 14px;
            color: #666;
            margin-bottom: 30px;
          }
          .qr-wrapper {
            background: white;
            padding: 20px;
            border-radius: 8px;
            display: inline-block;
            margin-bottom: 30px;
          }
          .qr-wrapper img {
            width: 250px;
            height: 250px;
            display: block;
          }
          .instruction {
            font-size: 12px;
            color: #999;
            margin-top: 20px;
          }
          @media print {
            body { background: white; padding: 0; }
            .container { box-shadow: none; padding: 20px; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${businessName}</h1>
          <p class="subtitle">Scan to view our digital menu</p>
          <div class="qr-wrapper">
            <img src="${qrCodeUrl}" alt="Menu QR Code" />
          </div>
          <p class="instruction">Point your camera at the QR code to view our menu</p>
        </div>
      </body>
      </html>
    `,
    modern: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Menu QR Code</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
          }
          .container {
            background: white;
            padding: 50px 40px;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 450px;
            width: 100%;
          }
          h1 {
            font-size: 32px;
            margin-bottom: 8px;
            color: #333;
            font-weight: 700;
          }
          .subtitle {
            font-size: 16px;
            color: #666;
            margin-bottom: 40px;
            font-weight: 500;
          }
          .qr-wrapper {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 30px;
            border-radius: 16px;
            display: inline-block;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);
          }
          .qr-wrapper img {
            width: 280px;
            height: 280px;
            display: block;
            background: white;
            padding: 10px;
            border-radius: 8px;
          }
          .instruction {
            font-size: 13px;
            color: #999;
            margin-top: 20px;
          }
          .icon {
            font-size: 24px;
            margin-bottom: 10px;
          }
          @media print {
            body { background: white; padding: 0; }
            .container { box-shadow: none; }
            .qr-wrapper { background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">📱</div>
          <h1>${businessName}</h1>
          <p class="subtitle">Scan to view our digital menu</p>
          <div class="qr-wrapper">
            <img src="${qrCodeUrl}" alt="Menu QR Code" />
          </div>
          <p class="instruction">Use your phone camera to scan the QR code</p>
        </div>
      </body>
      </html>
    `,
    elegant: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Menu QR Code</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Georgia', serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #f9f7f4;
            padding: 20px;
          }
          .container {
            background: white;
            padding: 60px 50px;
            border: 2px solid #d4af37;
            border-radius: 4px;
            text-align: center;
            max-width: 450px;
            width: 100%;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
          }
          .header-line {
            width: 60px;
            height: 2px;
            background: #d4af37;
            margin: 0 auto 20px;
          }
          h1 {
            font-size: 36px;
            margin-bottom: 5px;
            color: #333;
            font-weight: normal;
            letter-spacing: 2px;
          }
          .subtitle {
            font-size: 14px;
            color: #999;
            margin-bottom: 40px;
            font-style: italic;
            letter-spacing: 1px;
          }
          .qr-wrapper {
            background: #f9f7f4;
            padding: 40px;
            border: 1px solid #e0e0e0;
            display: inline-block;
            margin-bottom: 40px;
          }
          .qr-wrapper img {
            width: 260px;
            height: 260px;
            display: block;
          }
          .instruction {
            font-size: 12px;
            color: #999;
            margin-top: 20px;
            letter-spacing: 0.5px;
          }
          .footer-line {
            width: 60px;
            height: 2px;
            background: #d4af37;
            margin: 30px auto 0;
          }
          @media print {
            body { background: white; padding: 0; }
            .container { box-shadow: none; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header-line"></div>
          <h1>${businessName}</h1>
          <p class="subtitle">Digital Menu</p>
          <div class="qr-wrapper">
            <img src="${qrCodeUrl}" alt="Menu QR Code" />
          </div>
          <p class="instruction">Scan with your camera to view our menu</p>
          <div class="footer-line"></div>
        </div>
      </body>
      </html>
    `,
    colorful: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Menu QR Code</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(45deg, #ff6b6b, #ffd93d, #6bcf7f, #4d96ff);
            background-size: 400% 400%;
            animation: gradient 15s ease infinite;
            padding: 20px;
          }
          @keyframes gradient {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          .container {
            background: white;
            padding: 50px 40px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 450px;
            width: 100%;
          }
          h1 {
            font-size: 32px;
            margin-bottom: 8px;
            background: linear-gradient(135deg, #ff6b6b, #4d96ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: 700;
          }
          .subtitle {
            font-size: 16px;
            color: #666;
            margin-bottom: 40px;
            font-weight: 500;
          }
          .qr-wrapper {
            background: linear-gradient(135deg, #ff6b6b, #ffd93d);
            padding: 30px;
            border-radius: 20px;
            display: inline-block;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(255, 107, 107, 0.3);
          }
          .qr-wrapper img {
            width: 280px;
            height: 280px;
            display: block;
            background: white;
            padding: 10px;
            border-radius: 12px;
          }
          .instruction {
            font-size: 13px;
            color: #999;
            margin-top: 20px;
          }
          .emoji {
            font-size: 40px;
            margin-bottom: 10px;
          }
          @media print {
            body { background: white; padding: 0; animation: none; }
            .container { box-shadow: none; }
            .qr-wrapper { background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { background: none; -webkit-text-fill-color: unset; color: #333; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="emoji">🍽️</div>
          <h1>${businessName}</h1>
          <p class="subtitle">Scan to view our digital menu</p>
          <div class="qr-wrapper">
            <img src="${qrCodeUrl}" alt="Menu QR Code" />
          </div>
          <p class="instruction">Point your camera at the QR code</p>
        </div>
      </body>
      </html>
    `,
  };

  return designs[template.style] || designs.minimal;
};

const qrTemplates: QRTemplate[] = [
  {
    id: 'modern',
    name: 'Modern Gradient',
    description: 'Contemporary gradient design with modern aesthetics',
    size: 'medium',
    style: 'modern',
    features: ['Gradient background', 'Modern look', 'Eye-catching', 'Professional'],
  },
  {
    id: 'minimal',
    name: 'Clean Minimal',
    description: 'Clean and simple design, perfect for any business',
    size: 'medium',
    style: 'minimal',
    features: ['Clean design', 'Professional', 'Print-ready', 'Universal'],
  },
  {
    id: 'elegant',
    name: 'Premium Elegant',
    description: 'Sophisticated design with gold accents for upscale venues',
    size: 'medium',
    style: 'elegant',
    features: ['Gold accents', 'Elegant', 'Sophisticated', 'Premium feel'],
  },
  {
    id: 'colorful',
    name: 'Vibrant Fun',
    description: 'Vibrant and fun design perfect for casual restaurants',
    size: 'medium',
    style: 'colorful',
    features: ['Vibrant colors', 'Fun design', 'Eye-catching', 'Casual'],
  },
];

export function QRCodeTemplates({
  publicMenuUrl,
  businessName = 'Our Restaurant',
}: {
  publicMenuUrl: string;
  businessName?: string;
}) {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<QRTemplate | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [iframeHeight, setIframeHeight] = useState('600px');

  const handleIframeLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const iframe = e.currentTarget;
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const scrollHeight = iframeDoc.documentElement.scrollHeight;
        setIframeHeight(`${Math.max(scrollHeight, 400)}px`);
      }
    } catch (error) {
      console.error('Error calculating iframe height:', error);
      setIframeHeight('600px');
    }
  };

  useEffect(() => {
    if (publicMenuUrl) {
      // Generate QR code from the backend public menu URL
      // This ensures all QR codes point to the same menu URL from the backend
      setQrCodeUrl(
        `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(publicMenuUrl)}`
      );
    }
  }, [publicMenuUrl]);

  const handleDownloadPNG = async (template: QRTemplate) => {
    if (!qrCodeUrl) {
      toast({
        variant: 'destructive',
        title: 'QR Code not ready',
        description: 'Please wait for the QR code to load.',
      });
      return;
    }

    try {
      toast({
        title: 'Generating PNG...',
        description: 'Please wait while we prepare your QR code design.',
      });

      const content = generateQRDesignHTML(qrCodeUrl, businessName, template);
      
      // Create a temporary iframe to render the content
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.top = '-9999px';
      iframe.style.left = '-9999px';
      iframe.style.width = '500px';
      iframe.style.height = '600px';
      iframe.style.border = 'none';
      iframe.style.zIndex = '-9999';
      document.body.appendChild(iframe);

      // Write content to iframe
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        throw new Error('Could not access iframe document');
      }

      iframeDoc.open();
      iframeDoc.write(content);
      iframeDoc.close();

      // Wait for iframe to load and images to render
      await new Promise<void>((resolve) => {
        const checkReady = () => {
          try {
            const images = iframeDoc.querySelectorAll('img');
            let allLoaded = true;
            
            for (const img of images) {
              if (!img.complete) {
                allLoaded = false;
                break;
              }
            }
            
            if (allLoaded && iframeDoc.readyState === 'complete') {
              resolve();
            } else {
              setTimeout(checkReady, 100);
            }
          } catch (e) {
            setTimeout(checkReady, 100);
          }
        };
        
        iframe.onload = () => setTimeout(checkReady, 500);
        setTimeout(checkReady, 500);
      });

      // Additional wait to ensure all rendering is complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const canvas = await html2canvas(iframeDoc.body || iframeDoc.documentElement, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        imageTimeout: 10000,
        width: 500,
        height: 600,
      });

      document.body.removeChild(iframe);

      // Convert canvas to PNG data URL
      const pngDataUrl = canvas.toDataURL('image/png');
      
      if (!pngDataUrl || pngDataUrl === 'data:,') {
        throw new Error('Failed to generate PNG from canvas');
      }

      // Download directly from data URL
      const link = document.createElement('a');
      link.href = pngDataUrl;
      link.download = `qr-menu-${template.id}-${new Date().toISOString().split('T')[0]}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: 'PNG downloaded!',
        description: `${template.name} QR code has been downloaded as PNG.`,
      });
    } catch (error) {
      console.error('Error generating PNG:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate PNG. Please try again.',
      });
    }
  };

  const handleDownloadPDF = async (template: QRTemplate) => {
    if (!qrCodeUrl) {
      toast({
        variant: 'destructive',
        title: 'QR Code not ready',
        description: 'Please wait for the QR code to load.',
      });
      return;
    }

    try {
      toast({
        title: 'Generating PDF...',
        description: 'Please wait while we prepare your QR code design.',
      });

      const content = generateQRDesignHTML(qrCodeUrl, businessName, template);
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.srcdoc = content;
      document.body.appendChild(iframe);

      // Wait for iframe to load
      await new Promise((resolve) => {
        iframe.onload = resolve;
      });

      // Wait a bit for images to load
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const canvas = await html2canvas(iframe.contentDocument?.body || iframe.contentWindow?.document.body, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        allowTaint: true,
      });

      document.body.removeChild(iframe);

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const imgWidth = 210; // A4 width in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`qr-menu-${template.id}-${new Date().toISOString().split('T')[0]}.pdf`);

      toast({
        title: 'PDF downloaded!',
        description: `${template.name} QR code has been downloaded as PDF ready for print.`,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate PDF. Please try again.',
      });
    }
  };

  const handlePreview = (template: QRTemplate) => {
    setSelectedTemplate(template);
    setIsPreviewOpen(true);
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {qrTemplates.map((template) => (
          <Card key={template.id} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <QrCodeIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{template.name}</CardTitle>
                  </div>
                </div>
              </div>
              <CardDescription>{template.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="flex flex-wrap gap-1">
                {template.features.map((feature) => (
                  <Badge key={feature} variant="secondary" className="text-xs">
                    {feature}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handlePreview(template)}
                  disabled={!qrCodeUrl}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={!qrCodeUrl}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleDownloadPNG(template)}>
                      <FileImage className="mr-2 h-4 w-4" />
                      Download as PNG
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownloadPDF(template)}>
                      <FileText className="mr-2 h-4 w-4" />
                      Download as PDF
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Preview: {selectedTemplate?.name} QR Code Design</DialogTitle>
            <DialogDescription>
              This is how your QR code will look when printed. Users can scan it to access your digital menu.
            </DialogDescription>
          </DialogHeader>
          {selectedTemplate && qrCodeUrl && (
            <div className="flex-1 overflow-auto border rounded-lg bg-white">
              <iframe
                srcDoc={generateQRDesignHTML(qrCodeUrl, businessName, selectedTemplate)}
                className="w-full border-0"
                style={{ height: iframeHeight }}
                title="QR Code Preview"
                onLoad={handleIframeLoad}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
