// AeroMark - Client-side PDF Watermarking Logic

// Global Application State
let filesQueue = [];
let currentPreviewFileId = null;
let currentPreviewPageNum = 1;
let currentPreviewPdfDoc = null; // PDF.js instance
let renderScale = 1.0; // Render scale for fitting preview

// Fonts State
let customFontBytes = null;
let defaultFontBytes = null;

// Configure PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initLiveTime();
  fetchIpAddress();
  loadDefaultFont();
  loadSavedUserName();
  setupEventListeners();
  updateQueueUI();
});

// Live Clock in Header/Settings
function initLiveTime() {
  const timeDisplay = document.getElementById('live-time-display');
  const updateClock = () => {
    timeDisplay.textContent = formatDate(new Date());
  };
  updateClock();
  setInterval(updateClock, 1000);
}

// Fetch Public IP Address (100% client-side request)
async function fetchIpAddress() {
  const ipInput = document.getElementById('ip-address');
  const ipStatus = document.getElementById('ip-status-text');
  
  ipInput.placeholder = "조회 중...";
  ipStatus.textContent = "공인 IP 주소를 확인하는 중...";
  ipStatus.className = "field-info";
  
  try {
    // 5 second timeout using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error('IP API response error');
    const data = await response.json();
    ipInput.value = data.ip;
    ipStatus.textContent = "공인 IP 주소가 자동으로 확인되었습니다.";
    ipStatus.className = "field-info text-cyan";
  } catch (error) {
    console.error('IP Address fetch failed:', error);
    ipInput.value = "127.0.0.1";
    ipStatus.textContent = "IP 조회 실패 (수동 입력 가능)";
    ipStatus.className = "field-info text-pink";
    showToast("IP 조회에 실패하여 기본 로컬 IP로 설정했습니다.");
  }
  // Redraw preview overlay if a PDF is loaded
  triggerOverlayRedraw();
}

// Fetch NanumGothic from CDN for Korean characters
async function loadDefaultFont() {
  const fontStatus = document.getElementById('font-status-label');
  fontStatus.textContent = "한글 글꼴(나눔고딕) 불러오는 중...";
  fontStatus.style.color = "var(--text-muted)";
  
  try {
    const fontUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf';
    const response = await fetch(fontUrl);
    if (!response.ok) throw new Error('Font download failed');
    defaultFontBytes = await response.arrayBuffer();
    
    fontStatus.textContent = "기본값: 나눔고딕 (로드 완료)";
    fontStatus.style.color = "var(--success)";
  } catch (error) {
    console.error('Font load error:', error);
    fontStatus.textContent = "글꼴 로딩 실패 (오프라인 시 수동 등록 필요)";
    fontStatus.style.color = "var(--danger)";
    showToast("기본 한글 폰트 로드 실패. 오프라인 상태라면 직접 .ttf 파일을 등록하세요.");
  }
}

// Restore saved user name
function loadSavedUserName() {
  const savedName = localStorage.getItem('aeromark_username');
  if (savedName) {
    document.getElementById('user-name').value = savedName;
  }
}

// Format Date to YYYY-MM-DD HH:mm:ss
function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

// Helper to display toast message
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  toastMsg.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// Show/Hide Processing Modal Overlay
function setProcessingModal(show, title = "PDF 변환 중", desc = "잠시만 기다려주세요...", progress = 0) {
  const modal = document.getElementById('processing-modal');
  const mTitle = document.getElementById('modal-title');
  const mDesc = document.getElementById('modal-desc');
  const mProgressFill = document.getElementById('modal-progress-fill');
  const mProgressStatus = document.getElementById('modal-progress-status');
  
  if (show) {
    mTitle.textContent = title;
    mDesc.textContent = desc;
    mProgressFill.style.width = `${progress}%`;
    mProgressStatus.textContent = `${Math.round(progress)}% 완료`;
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Username LocalStorage sync
  const userNameInput = document.getElementById('user-name');
  userNameInput.addEventListener('input', (e) => {
    localStorage.setItem('aeromark_username', e.target.value.trim());
    triggerOverlayRedraw();
  });

  // IP manual edits & refresh button
  document.getElementById('ip-address').addEventListener('input', triggerOverlayRedraw);
  document.getElementById('btn-refresh-ip').addEventListener('click', fetchIpAddress);

  // Style Sliders UI sync & redraw overlay on changes
  const sliders = [
    { id: 'slider-font-size', valId: 'val-font-size', suffix: 'px' },
    { id: 'slider-opacity', valId: 'val-opacity', suffix: '%' },
    { id: 'slider-rotation', valId: 'val-rotation', suffix: '°' },
    { id: 'slider-grid-density', valId: 'val-grid-density', suffix: 'px' }
  ];
  
  sliders.forEach(slider => {
    const sliderEl = document.getElementById(slider.id);
    const valueEl = document.getElementById(slider.valId);
    
    sliderEl.addEventListener('input', (e) => {
      valueEl.textContent = `${e.target.value}${slider.suffix}`;
      triggerOverlayRedraw();
    });
  });

  // Accordion toggle for font settings
  const fontTrigger = document.getElementById('font-accordion-trigger');
  const fontContent = document.getElementById('font-accordion-content');
  const fontArrow = fontTrigger.querySelector('.accordion-arrow');
  fontTrigger.addEventListener('click', () => {
    fontContent.classList.toggle('hidden');
    fontArrow.classList.toggle('rotated');
  });

  // User manual font file upload
  const fontFileInput = document.getElementById('font-file-input');
  fontFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const fontStatus = document.getElementById('font-status-label');
    fontStatus.textContent = "글꼴 데이터 읽는 중...";
    fontStatus.style.color = "var(--text-muted)";
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      customFontBytes = evt.target.result;
      fontStatus.textContent = `사용자 지정: ${file.name} (로드 완료)`;
      fontStatus.style.color = "var(--success)";
      showToast("사용자 정의 TTF 폰트가 등록되었습니다.");
      triggerOverlayRedraw();
    };
    reader.onerror = () => {
      fontStatus.textContent = "글꼴 읽기 실패";
      fontStatus.style.color = "var(--danger)";
      showToast("글꼴 파일 읽기에 실패했습니다.");
    };
    reader.readAsArrayBuffer(file);
  });

  // Drag & Drop event bindings
  const dragZone = document.getElementById('drag-zone');
  const fileInput = document.getElementById('file-input');

  dragZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dragZone.classList.add('dragover');
  });

  dragZone.addEventListener('dragleave', () => {
    dragZone.classList.remove('dragover');
  });

  dragZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleUploadedFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleUploadedFiles(e.target.files);
    }
  });

  // Preview Pagination
  document.getElementById('prev-page').addEventListener('click', () => {
    if (currentPreviewPageNum > 1) {
      currentPreviewPageNum--;
      renderPreviewPage();
    }
  });

  document.getElementById('next-page').addEventListener('click', () => {
    if (currentPreviewPdfDoc && currentPreviewPageNum < currentPreviewPdfDoc.numPages) {
      currentPreviewPageNum++;
      renderPreviewPage();
    }
  });

  // Queue actions
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    filesQueue = [];
    currentPreviewFileId = null;
    currentPreviewPdfDoc = null;
    
    // Clear preview HTML elements
    document.getElementById('canvas-wrapper').classList.add('hidden');
    document.getElementById('preview-placeholder').classList.remove('hidden');
    document.getElementById('preview-pagination').style.display = 'none';
    
    updateQueueUI();
    showToast("대기열이 비워졌습니다.");
  });

  document.getElementById('btn-download-all').addEventListener('click', processAndDownloadAll);
}

// --- Upload Processing ---
async function handleUploadedFiles(filesList) {
  const pdfFiles = Array.from(filesList).filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  
  if (pdfFiles.length === 0) {
    showToast("업로드할 수 있는 PDF 파일이 없습니다.");
    return;
  }
  
  let addedCount = 0;
  for (const file of pdfFiles) {
    // Prevent duplicate files by checking name and size
    if (filesQueue.some(item => item.name === file.name && item.size === file.size)) {
      continue;
    }
    
    const fileId = 'pdf_' + Math.random().toString(36).substr(2, 9);
    
    // Read and parse page count client-side immediately
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      
      filesQueue.push({
        id: fileId,
        file: file,
        name: file.name,
        size: file.size,
        pageCount: pdf.numPages,
        status: 'pending',
        arrayBuffer: arrayBuffer // Cache buffer in memory for faster preview/edit
      });
      addedCount++;
    } catch (error) {
      console.error("Error reading PDF metadata:", error);
      showToast(`'${file.name}' 파일을 읽는 중 오류가 발생했습니다.`);
    }
  }
  
  if (addedCount > 0) {
    showToast(`${addedCount}개의 PDF 파일이 업로드되었습니다.`);
    updateQueueUI();
    
    // Auto preview the first file if none is selected
    if (!currentPreviewFileId && filesQueue.length > 0) {
      selectFileForPreview(filesQueue[0].id);
    }
  }
}

// --- Queue UI Synchronization ---
function updateQueueUI() {
  const queuePlaceholder = document.getElementById('queue-placeholder');
  const queueList = document.getElementById('queue-list');
  const queueActions = document.getElementById('queue-actions');
  const queueCount = document.getElementById('queue-count');
  
  queueCount.textContent = `${filesQueue.length}개 파일`;
  
  if (filesQueue.length === 0) {
    queuePlaceholder.classList.remove('hidden');
    queueList.classList.add('hidden');
    queueActions.classList.add('hidden');
    return;
  }
  
  queuePlaceholder.classList.add('hidden');
  queueList.classList.remove('hidden');
  queueActions.classList.remove('hidden');
  
  queueList.innerHTML = '';
  
  filesQueue.forEach(item => {
    const isSelected = item.id === currentPreviewFileId;
    const formattedSize = (item.size / (1024 * 1024)).toFixed(2) + ' MB';
    
    let statusClass = 'pending';
    let statusText = '대기 중';
    if (item.status === 'processing') {
      statusClass = 'processing';
      statusText = '작업 중';
    } else if (item.status === 'done') {
      statusClass = 'done';
      statusText = '완료';
    }
    
    const itemEl = document.createElement('div');
    itemEl.className = `queue-item ${isSelected ? 'active' : ''}`;
    itemEl.innerHTML = `
      <div class="file-icon" onclick="selectFileForPreview('${item.id}')" style="cursor: pointer;">
        <i class="fa-solid fa-file-pdf"></i>
      </div>
      <div class="file-details" onclick="selectFileForPreview('${item.id}')" style="cursor: pointer;">
        <div class="file-name" title="${item.name}">${item.name}</div>
        <div class="file-meta">
          <span>${formattedSize}</span>
          <span>•</span>
          <span>${item.pageCount}페이지</span>
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
      </div>
      <div class="queue-item-actions">
        ${item.status === 'done' ? `
          <button class="btn-success-icon" onclick="downloadSingleResult('${item.id}')" title="결과물 다운로드">
            <i class="fa-solid fa-circle-down"></i>
          </button>
        ` : `
          <button class="btn-success-icon" onclick="processSingleFile('${item.id}')" title="워터마크 삽입 및 다운로드">
            <i class="fa-solid fa-download"></i>
          </button>
        `}
        <button class="btn-danger-icon" onclick="removeFileFromQueue('${item.id}')" title="제거">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
    queueList.appendChild(itemEl);
  });
}

function removeFileFromQueue(id) {
  const index = filesQueue.findIndex(item => item.id === id);
  if (index === -1) return;
  
  filesQueue.splice(index, 1);
  
  if (currentPreviewFileId === id) {
    currentPreviewFileId = null;
    currentPreviewPdfDoc = null;
    
    document.getElementById('canvas-wrapper').classList.add('hidden');
    document.getElementById('preview-placeholder').classList.remove('hidden');
    document.getElementById('preview-pagination').style.display = 'none';
    
    // Auto-select another if available
    if (filesQueue.length > 0) {
      selectFileForPreview(filesQueue[0].id);
    }
  }
  
  updateQueueUI();
}

// --- Preview Rendering Logic ---
async function selectFileForPreview(id) {
  const fileItem = filesQueue.find(item => item.id === id);
  if (!fileItem) return;
  
  currentPreviewFileId = id;
  currentPreviewPageNum = 1;
  
  // Highlight active queue row
  updateQueueUI();
  
  // Show UI state
  document.getElementById('preview-placeholder').classList.add('hidden');
  document.getElementById('canvas-wrapper').classList.add('hidden');
  
  const loader = document.getElementById('preview-loader');
  loader.classList.remove('hidden');
  
  try {
    // Load PDF.js Document object using cached ArrayBuffer
    currentPreviewPdfDoc = await pdfjsLib.getDocument({ data: fileItem.arrayBuffer.slice(0) }).promise;
    
    // Show pagination bar
    const paginationBar = document.getElementById('preview-pagination');
    paginationBar.style.display = 'flex';
    
    renderPreviewPage();
  } catch (error) {
    console.error("Error loading PDF preview document:", error);
    loader.classList.add('hidden');
    document.getElementById('preview-placeholder').classList.remove('hidden');
    showToast("PDF 미리보기를 로드하지 못했습니다.");
  }
}

// Render PDF Page Content onto PDF Canvas
async function renderPreviewPage() {
  if (!currentPreviewPdfDoc) return;
  
  const viewportContainer = document.getElementById('preview-viewport');
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const pdfCanvas = document.getElementById('pdf-preview-canvas');
  const watermarkCanvas = document.getElementById('watermark-overlay-canvas');
  const loader = document.getElementById('preview-loader');
  
  loader.classList.remove('hidden');
  canvasWrapper.classList.add('hidden');
  
  try {
    const page = await currentPreviewPdfDoc.getPage(currentPreviewPageNum);
    
    // Calculate best scale to fit preview viewport
    const containerWidth = viewportContainer.clientWidth - 40;
    const containerHeight = viewportContainer.clientHeight - 40;
    
    const rawViewport = page.getViewport({ scale: 1.0 });
    const scaleX = containerWidth / rawViewport.width;
    const scaleY = containerHeight / rawViewport.height;
    
    renderScale = Math.min(scaleX, scaleY);
    renderScale = Math.max(0.2, Math.min(3.0, renderScale)); // Clamp scale
    
    const viewport = page.getViewport({ scale: renderScale });
    
    // Update layout canvas sizes
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    watermarkCanvas.width = viewport.width;
    watermarkCanvas.height = viewport.height;
    
    // Draw PDF page
    const renderCtx = pdfCanvas.getContext('2d');
    const renderContext = {
      canvasContext: renderCtx,
      viewport: viewport
    };
    
    await page.render(renderContext).promise;
    
    // Draw overlaid watermark on top canvas
    drawWatermarkOnCanvas();
    
    // Update pagination text
    document.getElementById('page-num-display').textContent = `${currentPreviewPageNum} / ${currentPreviewPdfDoc.numPages}`;
    document.getElementById('prev-page').disabled = currentPreviewPageNum === 1;
    document.getElementById('next-page').disabled = currentPreviewPageNum === currentPreviewPdfDoc.numPages;
    
    loader.classList.add('hidden');
    canvasWrapper.classList.remove('hidden');
  } catch (error) {
    console.error("Preview rendering failed:", error);
    loader.classList.add('hidden');
    showToast("페이지 미리보기 렌더링에 실패했습니다.");
  }
}

// Draw Grid Watermarks onto Overlay Canvas
function drawWatermarkOnCanvas() {
  const canvas = document.getElementById('watermark-overlay-canvas');
  if (!canvas || canvas.width === 0) return;
  
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  
  ctx.clearRect(0, 0, width, height);
  
  // Settings values
  const userName = document.getElementById('user-name').value.trim() || '홍길동';
  const ipAddress = document.getElementById('ip-address').value.trim() || '127.0.0.1';
  const timeStr = formatDate(new Date());
  
  const fontSizeInput = parseFloat(document.getElementById('slider-font-size').value);
  const opacityInput = parseFloat(document.getElementById('slider-opacity').value) / 100;
  const rotationInput = parseFloat(document.getElementById('slider-rotation').value);
  const gridDensityInput = parseFloat(document.getElementById('slider-grid-density').value);
  
  // Scale parameters based on canvas rendering scale
  const fontSize = fontSizeInput * renderScale;
  const gridDensity = gridDensityInput * renderScale;
  
  ctx.save();
  
  // Setup styles
  ctx.fillStyle = `rgba(128, 128, 128, ${opacityInput})`;
  ctx.font = `500 ${fontSize}px 'Nanum Gothic', 'Malgun Gothic', 'Inter', sans-serif`;
  ctx.textBaseline = 'top';
  
  const lines = [
    `출력자: ${userName}`,
    `IP 주소: ${ipAddress}`,
    `출력일시: ${timeStr}`
  ];
  
  const angleRad = (rotationInput * Math.PI) / 180;
  
  // Grid bounds coverage (handling overflow caused by rotation)
  const overflow = Math.max(width, height) * 1.5;
  
  for (let x = -overflow; x < width + overflow; x += gridDensity) {
    for (let y = -overflow; y < height + overflow; y += gridDensity) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angleRad);
      
      let lineY = 0;
      for (const line of lines) {
        ctx.fillText(line, 0, lineY);
        lineY += fontSize * 1.4;
      }
      ctx.restore();
    }
  }
  
  ctx.restore();
}

// Throttle/Redraw hook to avoid CPU spikes during slider adjustments
let overlayRedrawTimeout = null;
function triggerOverlayRedraw() {
  if (overlayRedrawTimeout) {
    cancelAnimationFrame(overlayRedrawTimeout);
  }
  overlayRedrawTimeout = requestAnimationFrame(() => {
    drawWatermarkOnCanvas();
  });
}

// --- PDF modification with PDF-Lib ---
async function applyWatermarkToPdf(fileItem) {
  // Read clean buffer
  const arrayBuffer = fileItem.arrayBuffer.slice(0);
  
  // Load PDFDocument
  const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
  
  // Register fontkit
  if (window.fontkit) {
    pdfDoc.registerFontkit(window.fontkit);
  } else {
    console.error("Fontkit not loaded! Custom fonts might not work.");
  }
  
  // Embed Korean font or fallback to Standard Fonts
  let fontBytesToUse = customFontBytes || defaultFontBytes;
  let embeddedFont;
  
  if (fontBytesToUse) {
    try {
      embeddedFont = await pdfDoc.embedFont(fontBytesToUse);
    } catch (e) {
      console.error("Failed to embed custom TTF, falling back to Helvetica:", e);
      embeddedFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    }
  } else {
    embeddedFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  }
  
  // Settings
  const userName = document.getElementById('user-name').value.trim() || '홍길동';
  const ipAddress = document.getElementById('ip-address').value.trim() || '127.0.0.1';
  const timeStr = formatDate(new Date());
  
  const fontSize = parseFloat(document.getElementById('slider-font-size').value);
  const opacity = parseFloat(document.getElementById('slider-opacity').value) / 100;
  const rotation = parseFloat(document.getElementById('slider-rotation').value);
  const gridDensity = parseFloat(document.getElementById('slider-grid-density').value);
  
  const watermarkText = `출력자: ${userName}\nIP 주소: ${ipAddress}\n출력일시: ${timeStr}`;
  
  const pages = pdfDoc.getPages();
  
  for (const page of pages) {
    const { width, height } = page.getSize();
    
    // Grid coordinate offsets covering page with safety margins
    const safetyMargin = Math.max(width, height) * 1.5;
    
    for (let x = -safetyMargin; x < width + safetyMargin; x += gridDensity) {
      for (let y = -safetyMargin; y < height + safetyMargin; y += gridDensity) {
        page.drawText(watermarkText, {
          x: x,
          y: y,
          size: fontSize,
          font: embeddedFont,
          color: PDFLib.rgb(0.5, 0.5, 0.5),
          opacity: opacity,
          rotate: PDFLib.degrees(rotation),
          lineHeight: fontSize * 1.4,
        });
      }
    }
  }
  
  const modifiedPdfBytes = await pdfDoc.save();
  return modifiedPdfBytes;
}

// --- Process Actions ---

// Process and Download Single File
async function processSingleFile(fileId) {
  const fileItem = filesQueue.find(item => item.id === fileId);
  if (!fileItem) return;
  
  fileItem.status = 'processing';
  updateQueueUI();
  setProcessingModal(true, "PDF 워터마크 작업 중", `'${fileItem.name}' 파일에 워터마크를 삽입하고 있습니다.`, 20);
  
  try {
    // Delay to let UI thread render loader
    await new Promise(r => setTimeout(r, 200));
    
    const outputBytes = await applyWatermarkToPdf(fileItem);
    
    setProcessingModal(true, "파일 다운로드 준비 중", "성공적으로 적용되었습니다.", 80);
    
    // Save to result object to allow multiple downloads
    fileItem.outputBytes = outputBytes;
    fileItem.status = 'done';
    
    // Trigger download
    downloadBytes(outputBytes, `watermarked_${fileItem.name}`, 'application/pdf');
    
    showToast(`'${fileItem.name}' 파일 작업 완료!`);
  } catch (error) {
    console.error("Single file process failed:", error);
    fileItem.status = 'pending';
    showToast(`파일 처리 도중 오류가 발생했습니다.`);
  } finally {
    setProcessingModal(false);
    updateQueueUI();
  }
}

// Download already compiled bytes (no reprocessing)
function downloadSingleResult(fileId) {
  const fileItem = filesQueue.find(item => item.id === fileId);
  if (fileItem && fileItem.outputBytes) {
    downloadBytes(fileItem.outputBytes, `watermarked_${fileItem.name}`, 'application/pdf');
    showToast(`'${fileItem.name}' 파일을 다운로드했습니다.`);
  }
}

// Process and Download All Files inside a single ZIP
async function processAndDownloadAll() {
  if (filesQueue.length === 0) {
    showToast("처리할 파일이 없습니다.");
    return;
  }
  
  setProcessingModal(true, "일괄 변환 시작", "대기 중인 파일들을 준비하고 있습니다...", 0);
  
  const zip = new JSZip();
  let completedCount = 0;
  
  try {
    for (let i = 0; i < filesQueue.length; i++) {
      const fileItem = filesQueue[i];
      fileItem.status = 'processing';
      updateQueueUI();
      
      const progressPercent = (i / filesQueue.length) * 80; // Scale processing to 80%
      setProcessingModal(
        true, 
        `PDF 일괄 워터마크 작업 (${i + 1}/${filesQueue.length})`, 
        `'${fileItem.name}' 작업 중...`, 
        progressPercent
      );
      
      await new Promise(r => setTimeout(r, 200)); // UI paint window
      
      const outputBytes = await applyWatermarkToPdf(fileItem);
      fileItem.outputBytes = outputBytes;
      fileItem.status = 'done';
      
      // Ensure unique filename inside ZIP
      let filename = `watermarked_${fileItem.name}`;
      zip.file(filename, outputBytes);
      
      completedCount++;
    }
    
    setProcessingModal(true, "ZIP 압축 생성 중", "파일들을 모아 ZIP 아카이브로 묶고 있습니다.", 85);
    await new Promise(r => setTimeout(r, 200));
    
    const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
      // Progress updates from JSZip (scaled from 85% to 100%)
      const zipProgress = 85 + (metadata.percent * 0.15);
      setProcessingModal(true, "ZIP 압축 생성 중", `압축 진행도: ${Math.round(metadata.percent)}%`, zipProgress);
    });
    
    const now = new Date();
    const dateStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    downloadBytes(zipBlob, `aeromark_documents_${dateStr}.zip`, 'application/zip');
    
    showToast(`총 ${completedCount}개의 PDF 변환 및 다운로드가 완료되었습니다.`);
  } catch (error) {
    console.error("Batch processing failed:", error);
    showToast("일괄 처리에 실패했습니다. 콘솔 로그를 확인하세요.");
  } finally {
    setProcessingModal(false);
    updateQueueUI();
  }
}

// Download Helper utilizing trigger Anchor tag click
function downloadBytes(bytesOrBlob, filename, mimeType) {
  const blob = bytesOrBlob instanceof Blob ? bytesOrBlob : new Blob([bytesOrBlob], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
