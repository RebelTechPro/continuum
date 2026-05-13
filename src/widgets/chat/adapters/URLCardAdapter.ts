/**
 * URL Card Message Content Adapter
 *
 * Handles link previews with rich metadata, favicons,
 * and future AI capabilities (content summarization, link verification)
 */

import type { ChatMessageEntity } from '../../../system/data/entities/ChatMessageEntity';
import { AbstractMessageAdapter } from './AbstractMessageAdapter';

// Verbose logging helper for browser
import type { JTAGWindowProperties } from '../../../system/core/types/GlobalAugmentations';

const verbose = () => typeof window !== 'undefined' && (window as Window & JTAGWindowProperties).JTAG_VERBOSE === true;

interface URLCardMetadata {
  readonly title: string;
  readonly description: string;
  readonly siteName: string;
  readonly imageUrl?: string;
}

interface URLCardData {
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  readonly siteName?: string;
  readonly favicon?: string;
  readonly imageUrl?: string;
  readonly domain: string;
  readonly isSecure: boolean;
  readonly originalText: string;
}

export class URLCardAdapter extends AbstractMessageAdapter<URLCardData> {
  constructor(options = {}, hooks = {}) {
    super('url_card', {
      enableIntersectionObserver: true,
      lazyLoadContent: true,
      enableInteractions: true,
      aiEditingEnabled: true, // AI can summarize, verify links
      ...options
    }, hooks);
  }

  /**
   * Parse URL and extract metadata from message text
   */
  parseContent(message: ChatMessageEntity): URLCardData | null {
    const text = message.content?.text;
    if (!text) return null;

    // Extract URL from text
    const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
    if (!urlMatch) return null;

    const url = urlMatch[1];
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const isSecure = urlObj.protocol === 'https:';

    return {
      url,
      domain,
      isSecure,
      originalText: text,
      title: `Link to ${domain}`, // AI will improve this
      description: 'Loading preview...', // Will be fetched/AI-generated
      siteName: domain,
      favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
    };
  }

  /**
   * Render rich URL card with metadata
   */
  renderContent(data: URLCardData, currentUserId: string): string {
    const { url, title, description, siteName, favicon, domain, isSecure, originalText } = data;
    const cardId = `url-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Extract any text that isn't the URL
    const additionalText = originalText.replace(url, '').trim();

    return `
      <div class="url-card-content">
        ${additionalText ? `<div class="url-message-text">${additionalText}</div>` : ''}

        <div class="url-card" data-card-id="${cardId}" data-url="${url}" data-action="url-card-click">
          <div class="url-card-loading" style="display: block;">
            <div class="loading-spinner"></div>
            <span class="loading-text">Loading preview...</span>
          </div>

          <div class="url-card-content-area" style="display: none;">
            <div class="url-card-header">
              <img src="${favicon}" alt="${domain} favicon" class="site-favicon" loading="lazy" />
              <div class="site-info">
                <span class="site-name">${siteName}</span>
                <span class="url-domain ${isSecure ? 'secure' : 'insecure'}">
                  ${isSecure ? '🔒' : '🔓'} ${domain}
                </span>
              </div>
              <div class="card-actions">
                <button class="action-button" data-action="url-ai-summarize" title="AI summarize">🤖</button>
                <button class="action-button" data-action="url-open-external" title="Open in new tab">↗️</button>
              </div>
            </div>

            <div class="url-card-body">
              <h3 class="url-title">${title}</h3>
              <p class="url-description">${description}</p>
              <div class="url-metadata">
                <span class="url-full" title="${url}">${url}</span>
              </div>
            </div>

            <div class="url-card-image" style="display: none;">
              <img src="" alt="Preview image" class="preview-image" loading="lazy" />
            </div>
          </div>

          <div class="url-card-error" style="display: none;">
            <div class="error-content">
              <span class="error-icon">🔗</span>
              <span class="error-text">Preview unavailable</span>
              <button class="retry-preview" data-action="url-retry-preview" data-url="${url}">Retry</button>
            </div>
            <div class="fallback-link">
              <a href="${url}" target="_blank" rel="noopener noreferrer" class="external-link-fallback">
                ${url}
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * DOM-returning render path (see issue #1100). The legacy string
   * path interpolated `${additionalText}` (user message text), `${url}`,
   * `${domain}`, `${title}`, `${description}`, `${siteName}`, and
   * `${favicon}` directly into HTML — at least the additionalText path
   * is a real XSS hole (any user can craft a message with a URL plus
   * markup and have it land in element-content position).
   *
   * This migration moves every user-controllable value to
   * `.textContent` / property assignment / dataset, and keeps the
   * class names + data-action attributes verbatim so:
   *   - `handleContentLoading()` finds `.url-card`, `.url-card-loading`,
   *     `.url-card-content-area`, `.url-card-error` via querySelector
   *   - `updateCardWithMetadata()` finds `.url-title`, `.url-description`,
   *     `.site-name`, `.url-card-image`, `.preview-image`
   *   - `MessageEventDelegator` finds `data-action="url-card-click"`,
   *     `url-ai-summarize`, `url-open-external`, `url-retry-preview`
   *   - Static handlers (handleCardClick, handleOpenExternal, etc.)
   *     find `.url-card` via `closest()` and read `dataset.url`
   */
  override renderMessageElement(message: ChatMessageEntity, _currentUserId: string): HTMLElement | null {
    try {
      const data = this.parseContent(message);
      if (!data) return null;
      this.contentData = data;

      const { url, title, description, siteName, favicon, domain, isSecure, originalText } = data;
      const cardId = `url-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const additionalText = originalText.replace(url, '').trim();

      const wrapper = this.createAdapterWrapper();

      const outer = document.createElement('div');
      outer.className = 'url-card-content';
      wrapper.appendChild(outer);

      if (additionalText) {
        const messageText = document.createElement('div');
        messageText.className = 'url-message-text';
        // textContent — additionalText originates from message.content.text
        // and must not be interpreted as HTML.
        messageText.textContent = additionalText;
        outer.appendChild(messageText);
      }

      const card = document.createElement('div');
      card.className = 'url-card';
      card.dataset.cardId = cardId;
      card.dataset.url = url;
      card.dataset.action = 'url-card-click';
      outer.appendChild(card);

      // Loading state (visible by default; handleContentLoading hides it)
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'url-card-loading';
      loadingDiv.style.display = 'block';
      const spinner = document.createElement('div');
      spinner.className = 'loading-spinner';
      const loadingText = document.createElement('span');
      loadingText.className = 'loading-text';
      loadingText.textContent = 'Loading preview...';
      loadingDiv.appendChild(spinner);
      loadingDiv.appendChild(loadingText);
      card.appendChild(loadingDiv);

      // Content area (hidden until metadata loads)
      const contentArea = document.createElement('div');
      contentArea.className = 'url-card-content-area';
      contentArea.style.display = 'none';
      card.appendChild(contentArea);

      const header = document.createElement('div');
      header.className = 'url-card-header';
      contentArea.appendChild(header);

      const faviconImg = document.createElement('img');
      faviconImg.src = favicon ?? '';
      faviconImg.alt = `${domain} favicon`;
      faviconImg.className = 'site-favicon';
      faviconImg.loading = 'lazy';
      header.appendChild(faviconImg);

      const siteInfo = document.createElement('div');
      siteInfo.className = 'site-info';
      const siteNameEl = document.createElement('span');
      siteNameEl.className = 'site-name';
      siteNameEl.textContent = siteName ?? domain;
      const urlDomain = document.createElement('span');
      urlDomain.className = `url-domain ${isSecure ? 'secure' : 'insecure'}`;
      // Lock/unlock glyph + space + domain, set as separate text nodes so
      // domain stays escaped.
      urlDomain.appendChild(document.createTextNode(isSecure ? '🔒 ' : '🔓 '));
      urlDomain.appendChild(document.createTextNode(domain));
      siteInfo.appendChild(siteNameEl);
      siteInfo.appendChild(urlDomain);
      header.appendChild(siteInfo);

      const cardActions = document.createElement('div');
      cardActions.className = 'card-actions';
      cardActions.appendChild(this.buildActionButton('url-ai-summarize', '🤖', 'AI summarize'));
      cardActions.appendChild(this.buildActionButton('url-open-external', '↗️', 'Open in new tab'));
      header.appendChild(cardActions);

      const cardBody = document.createElement('div');
      cardBody.className = 'url-card-body';
      contentArea.appendChild(cardBody);

      const titleEl = document.createElement('h3');
      titleEl.className = 'url-title';
      titleEl.textContent = title ?? `Link to ${domain}`;
      cardBody.appendChild(titleEl);

      const descEl = document.createElement('p');
      descEl.className = 'url-description';
      descEl.textContent = description ?? '';
      cardBody.appendChild(descEl);

      const urlMetadata = document.createElement('div');
      urlMetadata.className = 'url-metadata';
      const urlFull = document.createElement('span');
      urlFull.className = 'url-full';
      urlFull.title = url;
      urlFull.textContent = url;
      urlMetadata.appendChild(urlFull);
      cardBody.appendChild(urlMetadata);

      // Image preview slot (hidden until metadata loads)
      const imageContainer = document.createElement('div');
      imageContainer.className = 'url-card-image';
      imageContainer.style.display = 'none';
      const previewImg = document.createElement('img');
      previewImg.src = '';
      previewImg.alt = 'Preview image';
      previewImg.className = 'preview-image';
      previewImg.loading = 'lazy';
      imageContainer.appendChild(previewImg);
      contentArea.appendChild(imageContainer);

      // Error state (hidden until metadata load fails)
      const errorDiv = document.createElement('div');
      errorDiv.className = 'url-card-error';
      errorDiv.style.display = 'none';
      const errorContent = document.createElement('div');
      errorContent.className = 'error-content';
      const errorIcon = document.createElement('span');
      errorIcon.className = 'error-icon';
      errorIcon.textContent = '🔗';
      const errorText = document.createElement('span');
      errorText.className = 'error-text';
      errorText.textContent = 'Preview unavailable';
      const retryBtn = document.createElement('button');
      retryBtn.className = 'retry-preview';
      retryBtn.dataset.action = 'url-retry-preview';
      retryBtn.dataset.url = url;
      retryBtn.textContent = 'Retry';
      errorContent.appendChild(errorIcon);
      errorContent.appendChild(errorText);
      errorContent.appendChild(retryBtn);
      errorDiv.appendChild(errorContent);

      const fallbackLink = document.createElement('div');
      fallbackLink.className = 'fallback-link';
      const externalLink = document.createElement('a');
      externalLink.href = url;
      externalLink.target = '_blank';
      externalLink.rel = 'noopener noreferrer';
      externalLink.className = 'external-link-fallback';
      externalLink.textContent = url;
      fallbackLink.appendChild(externalLink);
      errorDiv.appendChild(fallbackLink);
      card.appendChild(errorDiv);

      return wrapper;
    } catch (error) {
      console.error('URLCardAdapter.renderMessageElement failed:', error);
      return null;
    }
  }

  /**
   * Helper to build an action button with consistent class + data-action,
   * an aria-label mirroring the title (titles aren't reliable for SR),
   * and a textContent label.
   */
  private buildActionButton(action: string, label: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'action-button';
    btn.dataset.action = action;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.textContent = label;
    return btn;
  }

  /**
   * Handle URL metadata fetching and card population
   */
  async handleContentLoading(element: HTMLElement): Promise<void> {
    const card = element.querySelector('.url-card') as HTMLElement;
    const loadingDiv = element.querySelector('.url-card-loading') as HTMLElement;
    const contentDiv = element.querySelector('.url-card-content-area') as HTMLElement;
    const errorDiv = element.querySelector('.url-card-error') as HTMLElement;

    if (!card) return;

    const url = card.dataset.url;
    if (!url) return;

    try {
      // Simulate fetching metadata (future: real metadata service)
      await this.fetchMetadata(url, element);

      loadingDiv.style.display = 'none';
      contentDiv.style.display = 'block';
    } catch (error) {
      console.error('Failed to load URL metadata:', error);
      loadingDiv.style.display = 'none';
      errorDiv.style.display = 'block';
    }
  }

  /**
   * Fetch URL metadata (future: real implementation)
   */
  private async fetchMetadata(url: string, element: HTMLElement): Promise<void> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    // Future: Real metadata fetching
    // const metadata = await metadataService.fetch(url);

    // For demo, simulate some rich data
    const mockMetadata = this.generateMockMetadata(url);
    this.updateCardWithMetadata(element, mockMetadata);
  }

  /**
   * Generate mock metadata for demo purposes
   */
  private generateMockMetadata(url: string): URLCardMetadata {
    const domain = new URL(url).hostname;
    return {
      title: `Interesting content from ${domain}`,
      description: `Check out this fascinating content that was shared. This is a preview of what you'll find when you visit the link.`,
      siteName: domain,
      imageUrl: Math.random() > 0.5 ? 'https://picsum.photos/400/200' : undefined
    };
  }

  /**
   * Update card with fetched metadata
   */
  private updateCardWithMetadata(element: HTMLElement, metadata: URLCardMetadata): void {
    const titleEl = element.querySelector('.url-title');
    const descEl = element.querySelector('.url-description');
    const siteNameEl = element.querySelector('.site-name');
    const imageContainer = element.querySelector('.url-card-image') as HTMLElement;
    const previewImg = element.querySelector('.preview-image') as HTMLImageElement;

    if (titleEl) titleEl.textContent = metadata.title;
    if (descEl) descEl.textContent = metadata.description;
    if (siteNameEl) siteNameEl.textContent = metadata.siteName;

    if (metadata.imageUrl && previewImg) {
      previewImg.src = metadata.imageUrl;
      imageContainer.style.display = 'block';
    }
  }

  /**
   * CSS classes specific to URL card content
   */
  getContentClasses(): string[] {
    return ['url-card-content', 'interactive-content', 'rich-content'];
  }

  // NOTE: setupInteractionHandlers removed - now uses event delegation
  // Action handlers are static and called by MessageEventDelegator in ChatWidget

  /**
   * Static action handlers for event delegation
   * These are called by MessageEventDelegator, not per-element listeners
   */

  /**
   * Handle card click - open URL in new tab
   */
  static handleCardClick(target: HTMLElement, event: Event): void {
    // Don't trigger if clicking on buttons
    if ((event.target as HTMLElement).tagName === 'BUTTON') return;

    const card = target.closest('.url-card') as HTMLElement;
    const url = card?.dataset.url;
    if (url) {
      URLCardAdapter.openExternalLink(url);
    }
  }

  /**
   * Handle external link button click
   */
  static handleOpenExternal(target: HTMLElement): void {
    const card = target.closest('.url-card') as HTMLElement;
    const url = card?.dataset.url;
    if (url) {
      URLCardAdapter.openExternalLink(url);
    }
  }

  /**
   * Request AI summarization of the linked content
   */
  static handleAISummarize(target: HTMLElement): void {
    const card = target.closest('.url-card') as HTMLElement;
    const url = card?.dataset.url;
    if (!url) return;

    verbose() && console.log('🤖 Requesting AI summary for:', url);
    // Future: AI content summarization
  }

  /**
   * Retry preview loading
   */
  static handleRetryPreview(target: HTMLElement): void {
    const card = target.closest('.url-card') as HTMLElement;
    if (!card) return;

    const loadingDiv = card.querySelector('.url-card-loading') as HTMLElement;
    const contentDiv = card.querySelector('.url-card-content-area') as HTMLElement;
    const errorDiv = card.querySelector('.url-card-error') as HTMLElement;

    if (loadingDiv && contentDiv && errorDiv) {
      // Reset states to loading
      errorDiv.style.display = 'none';
      loadingDiv.style.display = 'block';
      contentDiv.style.display = 'none';

      // Note: Actual retry would need adapter instance or separate fetch
      verbose() && console.log('🔄 Retrying preview for:', card.dataset.url);
    }
  }

  /**
   * Open URL in new tab safely
   */
  private static openExternalLink(url: string): void {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    verbose() && console.log('🔗 Opening external link:', url);
  }

  /**
   * CSS styles for URL cards
   */
  getCSS(): string {
    return `
      .content-type-url_card {
        border: 1px solid #e1e5e9;
        border-radius: 8px;
        overflow: hidden;
        margin: 8px 0;
        background: #ffffff;
      }
      .url-card-header {
        display: flex;
        align-items: center;
        padding: 12px;
        background: #f8f9fa;
        border-bottom: 1px solid #e1e5e9;
      }
      .url-card-favicon {
        width: 16px;
        height: 16px;
        margin-right: 8px;
        border-radius: 2px;
      }
      .url-card-domain {
        font-size: 12px;
        color: #6c757d;
        font-weight: 500;
      }
      .url-card-body {
        padding: 12px;
      }
      .url-card-title {
        font-weight: 600;
        margin-bottom: 4px;
        color: #1a1a1a;
      }
      .url-card-description {
        color: #666;
        font-size: 14px;
        line-height: 1.4;
        margin-bottom: 8px;
      }
      .url-card-image {
        width: 100%;
        max-height: 200px;
        object-fit: cover;
        border-radius: 4px;
      }
      .url-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: #f8f9fa;
        border-top: 1px solid #e1e5e9;
      }
      .url-card-link {
        color: #007bff;
        text-decoration: none;
        font-size: 12px;
        font-weight: 500;
      }
      .url-card-link:hover {
        text-decoration: underline;
      }
      .url-card-loading, .url-card-error {
        padding: 16px;
        text-align: center;
        color: #6c757d;
      }
    `;
  }

  /**
   * AI-editable fields for URL cards
   */
  protected getAIEditableFields(): Record<string, string> {
    return {
      title: 'string',
      description: 'string',
      summary: 'string',
      tags: 'array',
      relevanceScore: 'number'
    };
  }

  /**
   * Handle AI editing of URL card content
   */
  async handleAIEdit(editInstructions: Record<string, unknown>): Promise<void> {
    verbose() && console.log('🤖 AI editing URL card:', editInstructions);

    // Future: AI can:
    // - Generate better titles
    // - Create summaries
    // - Verify link safety
    // - Extract key information
    // - Add relevance scoring

    if (editInstructions.improveTitle) {
      // const betterTitle = await aiService.improveTitle(this.contentData?.url);
    }

    if (editInstructions.generateSummary) {
      // const summary = await aiService.summarizeContent(this.contentData?.url);
    }

    super.handleAIEdit(editInstructions);
  }
}