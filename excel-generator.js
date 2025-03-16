const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * Generates an Excel report for a form submission
 * @param {Object} submissionData - The submission data
 * @param {String} submissionId - The submission ID
 * @param {String} reportsDir - Directory to save the report
 * @returns {Promise<Object>} - Object with report path and qualification data
 */
async function generateExcelReport(submissionData, submissionId, reportsDir) {
  try {
    console.log(`Generating Excel report for submission ${submissionId}`);
    
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ERTC Webhook Receiver';
    workbook.lastModifiedBy = 'ERTC Webhook Receiver';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Summary sheet
    const summarySheet = workbook.addWorksheet('Form Submission Summary');
    
    // Style for headers
    const headerStyle = {
      font: { bold: true, size: 12, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } },
      alignment: { horizontal: 'left' },
      border: {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    };
    
    // Style for section headers
    const sectionHeaderStyle = {
      font: { bold: true, size: 14 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDEEBF7' } }
    };
    
    summarySheet.columns = [
      { header: 'Field', key: 'field', width: 40 },
      { header: 'Value', key: 'value', width: 60 }
    ];
    
    // Apply header styles
    summarySheet.getRow(1).eachCell(cell => {
      cell.style = headerStyle;
    });
    
    // Function to add a section header
    function addSectionHeader(sheet, title) {
      const row = sheet.addRow([title, '']);
      row.eachCell(cell => {
        cell.style = sectionHeaderStyle;
      });
      sheet.addRow(['', '']); // Empty row after section header
    }
    
    // Function to add rows for an object
    function addObjectRows(sheet, obj, prefix = '') {
      if (!obj) return;
      
      Object.entries(obj).forEach(([key, value]) => {
        const fieldName = prefix ? `${prefix} - ${key}` : key;
        
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // If value is an object (but not array), recurse with a prefix
          addObjectRows(sheet, value, fieldName);
        } else if (Array.isArray(value)) {
          // For arrays, stringify them or handle specially
          if (value.length === 0) {
            sheet.addRow([fieldName, 'None']);
          } else if (typeof value[0] === 'object') {
            // For array of objects, add each as a separate row
            sheet.addRow([fieldName, `${value.length} items`]);
            value.forEach((item, index) => {
              addObjectRows(sheet, item, `${fieldName} #${index + 1}`);
            });
          } else {
            // For array of primitives
            sheet.addRow([fieldName, value.join(', ')]);
          }
        } else {
          // For primitive values
          sheet.addRow([fieldName, value?.toString() || 'N/A']);
        }
      });
    }
    
    // Get the original data and formData
    const originalData = submissionData.originalData || {};
    const formData = originalData.formData || {};
    
    // Add submission ID and timestamp
    summarySheet.addRow(['Submission ID', submissionId]);
    summarySheet.addRow(['Submission Date', submissionData.receivedAt]);
    summarySheet.addRow(['', '']); // Empty row
    
    // Basic info section
    addSectionHeader(summarySheet, 'Basic Information');
    if (formData.userEmail) {
      summarySheet.addRow(['Email', formData.userEmail]);
    }
    summarySheet.addRow(['', '']); // Empty row
    
    // Qualifying Questions section
    addSectionHeader(summarySheet, 'Qualifying Questions');
    if (formData.qualifyingQuestions) {
      addObjectRows(summarySheet, formData.qualifyingQuestions);
    }
    summarySheet.addRow(['', '']); // Empty row
    
    // Business Challenges section
    addSectionHeader(summarySheet, 'Business Challenges');
    if (formData.businessChallenges) {
      addObjectRows(summarySheet, formData.businessChallenges);
    }
    summarySheet.addRow(['', '']); // Empty row
    
    // Requested Info section
    addSectionHeader(summarySheet, 'Requested Information');
    if (formData.requestedInfo) {
      addObjectRows(summarySheet, formData.requestedInfo);
    }
    summarySheet.addRow(['', '']); // Empty row
    
    // Ownership Structure section
    addSectionHeader(summarySheet, 'Ownership Structure');
    if (formData.ownershipStructure && formData.ownershipStructure.length > 0) {
      formData.ownershipStructure.forEach((owner, index) => {
        summarySheet.addRow([`Owner #${index + 1} Name`, owner.owner_name]);
        summarySheet.addRow([`Owner #${index + 1} Percentage`, owner.ownership_percentage + '%']);
      });
    } else {
      summarySheet.addRow(['Ownership Structure', 'None provided']);
    }
    summarySheet.addRow(['', '']); // Empty row
    
    // Relatives section
    addSectionHeader(summarySheet, 'Relatives');
    if (formData.relatives) {
      summarySheet.addRow(['Has Relatives Working in Business', formData.relatives.has_relatives]);
      if (formData.relatives.has_relatives === 'yes' && formData.relatives.relative_rows) {
        formData.relatives.relative_rows.forEach((relative, index) => {
          summarySheet.addRow([`Relative #${index + 1} Name`, relative.relative_name]);
          summarySheet.addRow([`Relative #${index + 1} Relationship`, relative.relationship]);
        });
      }
    }
    summarySheet.addRow(['', '']); // Empty row
    
    // Uploaded Files section
    addSectionHeader(summarySheet, 'Uploaded Files');
    if (formData.uploadedFiles) {
      Object.entries(formData.uploadedFiles).forEach(([fileCategory, files]) => {
        if (files && files.length > 0) {
          summarySheet.addRow([fileCategory, `${files.length} file(s) uploaded`]);
          files.forEach((file, index) => {
            summarySheet.addRow([`${fileCategory} #${index + 1}`, file.name]);
          });
        }
      });
    } else {
      summarySheet.addRow(['Uploaded Files', 'None']);
    }
    
    // Revenue Analysis Sheet
    const analysisSheet = workbook.addWorksheet('Revenue Analysis');
    
    analysisSheet.columns = [
      { header: 'Quarter', key: 'quarter', width: 15 },
      { header: '2019 Revenue', key: 'revenue2019', width: 20 },
      { header: '2021 Revenue', key: 'revenue2021', width: 20 },
      { header: 'Revenue Change', key: 'change', width: 20 },
      { header: 'Percent Decrease', key: 'percentDecrease', width: 20 },
      { header: 'Qualifies (>50% Decrease)', key: 'qualifies', width: 25 }
    ];
    
    // Apply header styles to analysis sheet
    analysisSheet.getRow(1).eachCell(cell => {
      cell.style = headerStyle;
    });
    
    // Add title and description
    analysisSheet.addRow(['Revenue Analysis for Qualification', '', '', '', '', '']);
    analysisSheet.getRow(2).getCell(1).font = { bold: true, size: 16 };
    analysisSheet.getRow(2).height = 30;
    
    analysisSheet.addRow(['Comparing 2019 vs 2021 quarterly revenue to determine qualification based on revenue reduction', '', '', '', '', '']);
    analysisSheet.addRow(['Formula: (2019 Revenue - 2021 Revenue) / 2019 Revenue', '', '', '', '', '']);
    analysisSheet.addRow(['A quarter qualifies if the reduction is more than 50%', '', '', '', '', '']);
    analysisSheet.addRow(['', '', '', '', '', '']); // Empty row
    
    // Add data rows and calculate
    const requestedInfo = formData.requestedInfo || {};
    const grossSales2019 = requestedInfo.gross_sales_2019 || {};
    const grossSales2021 = requestedInfo.gross_sales_2021 || {};
    
    const quarters = ['q1', 'q2', 'q3'];
    quarters.forEach(q => {
      const revenue2019 = parseFloat(grossSales2019[q]) || 0;
      const revenue2021 = parseFloat(grossSales2021[q]) || 0;
      
      let change = 0;
      let percentDecrease = 0;
      let qualifies = 'No';
      
      if (revenue2019 > 0) {
        change = revenue2019 - revenue2021;
        percentDecrease = (change / revenue2019) * 100;
        qualifies = percentDecrease >= 50 ? 'Yes' : 'No';
      }
      
      const row = analysisSheet.addRow([
        `Quarter ${q.toUpperCase().replace('Q', '')}`,
        revenue2019,
        revenue2021,
        change,
        percentDecrease.toFixed(2) + '%',
        qualifies
      ]);
      
      // Add conditional formatting for qualification column
      if (qualifies === 'Yes') {
        row.getCell(6).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF92D050' } // Green for qualifying
        };
      }
    });
    
    // Apply number formatting
    analysisSheet.getColumn(2).numFmt = '$#,##0.00';
    analysisSheet.getColumn(3).numFmt = '$#,##0.00';
    analysisSheet.getColumn(4).numFmt = '$#,##0.00';
    
    // Add summary box
    const qualifyingQuarters = [];
    quarters.forEach((q, index) => {
      const row = analysisSheet.getRow(index + 8); // Starting from row 8 (after headers and intro text)
      if (row.getCell(6).value === 'Yes') {
        qualifyingQuarters.push(`Quarter ${q.toUpperCase().replace('Q', '')}`);
      }
    });
    
    analysisSheet.addRow(['', '', '', '', '', '']); // Empty row
    analysisSheet.addRow(['Summary:', '', '', '', '', '']);
    
    let summaryRow;
    if (qualifyingQuarters.length > 0) {
      summaryRow = analysisSheet.addRow([
        `Client qualifies based on revenue reduction for: ${qualifyingQuarters.join(', ')}`,
        '', '', '', '', ''
      ]);
    } else {
      summaryRow = analysisSheet.addRow([
        'Client does not qualify based on revenue reduction alone',
        '', '', '', '', ''
      ]);
    }
    
    summaryRow.getCell(1).font = { bold: true };
    if (qualifyingQuarters.length > 0) {
      summaryRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF92D050' } // Green for qualifying
      };
    }
    
    // Create quarter analysis data for MongoDB
    const quarterAnalysis = quarters.map((q, index) => {
      const row = analysisSheet.getRow(index + 8); // Starting from row 8
      const percentDecreaseText = row.getCell(5).value;
      const percentDecreaseValue = parseFloat(percentDecreaseText.replace('%', ''));
      
      return {
        quarter: `Quarter ${q.toUpperCase().replace('Q', '')}`,
        revenues: {
          revenue2019: parseFloat(grossSales2019[q]) || 0,
          revenue2021: parseFloat(grossSales2021[q]) || 0
        },
        change: parseFloat(grossSales2019[q] || 0) - parseFloat(grossSales2021[q] || 0),
        percentDecrease: percentDecreaseValue,
        qualifies: row.getCell(6).value === 'Yes'
      };
    });
    
    // Save the workbook
    const reportPath = path.join(reportsDir, `report_${submissionId}.xlsx`);
    await workbook.xlsx.writeFile(reportPath);
    console.log(`Excel report saved to ${reportPath}`);
    
    // Return both the report path and qualification data
    return {
      reportPath,
      qualificationData: {
        qualifyingQuarters,
        quarterAnalysis
      }
    };
  } catch (error) {
    console.error('Error generating Excel report:', error);
    throw error;
  }
}

module.exports = {
  generateExcelReport
};