import React from 'react';
import { TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AdminNavApp from '../../../components/AdminNavApp';
import AdminInput from "../../../components/AdminInput";
import Requests from "../../../common/requests";
import {randomShortUUID, ADMIN_URLS, PUBLIC_URLS} from '../../../../common-src/StringUtils';
import AdminImageUploaderApp from "../../../components/AdminImageUploaderApp";
import AdminDatetimePicker from '../../../components/AdminDatetimePicker';
import {datetimeLocalStringToMs, datetimeLocalToMs} from "../../../../common-src/TimeUtils";
import {getPublicBaseUrl} from "../../../common/ClientUrlUtils";
import AdminRadio from "../../../components/AdminRadio";
import {showToast} from "../../../common/ToastUtils";
import {unescapeHtml} from "../../../../common-src/StringUtils";
import MediaManager from "./components/MediaManager";
import {
  NAV_ITEMS,
  NAV_ITEMS_DICT,
  STATUSES,
  ITEM_STATUSES_DICT,
  SUPPORTED_LANGUAGES,
  LANGUAGE_NAMES,
  TRANSLATABLE_ITEM_FIELDS,
} from "../../../../common-src/Constants";
import {AdminSideQuickLinks, SideQuickLink} from "../../../components/AdminSideQuickLinks";
import AdminRichEditor from "../../../components/AdminRichEditor";
import ExplainText from "../../../components/ExplainText";
import {
  ITEM_CONTROLS,
  CONTROLS_TEXTS_DICT
} from "./FormExplainTexts";
import {preventCloseWhenChanged} from "../../../common/BrowserUtils";
import {getMediaFileFromUrl} from "../../../../common-src/MediaFileUtils";

const SUBMIT_STATUS__START = 1;

function initItem(itemId) {
  return ({
    status: STATUSES.PUBLISHED,
    pubDateMs: datetimeLocalToMs(new Date()),
    guid: itemId,
    'itunes:explicit': false,
    'itunes:block': false,
    'itunes:episodeType': 'full',
    // Initialize with default language (English)
    languages: ['en'],
    content: {
      en: {
        title: '',
        description: '',
        image: '',
        link: '',
        'itunes:title': '',
      }
    }
  });
}

// Helper function to migrate old item structure to new multi-language structure
function migrateItemToMultiLanguage(item) {
  // Check if item is already in new format
  if (item.content && item.languages) {
    return item;
  }

  // Migrate old structure to new multi-language structure
  const migratedItem = {
    ...item,
    languages: ['en'],
    content: {
      en: {}
    }
  };

  // Move translatable fields to content.en
  TRANSLATABLE_ITEM_FIELDS.forEach(field => {
    if (item[field] !== undefined) {
      migratedItem.content.en[field] = item[field];
      delete migratedItem[field];
    }
  });

  return migratedItem;
}

// Helper function to flatten item for backward compatibility with API
function flattenItemForSave(item, defaultLanguage = 'en') {
  const flattened = {
    ...item,
  };

  // For backward compatibility, copy default language fields to root
  if (item.content && item.content[defaultLanguage]) {
    Object.keys(item.content[defaultLanguage]).forEach(field => {
      flattened[field] = item.content[defaultLanguage][field];
    });
  }

  return flattened;
}

export default class EditItemApp extends React.Component {
  constructor(props) {
    super(props);

    this.onSubmit = this.onSubmit.bind(this);
    this.onDelete = this.onDelete.bind(this);
    this.onUpdateFeed = this.onUpdateFeed.bind(this);
    this.onUpdateItemMeta = this.onUpdateItemMeta.bind(this);
    this.onUpdateItemContent = this.onUpdateItemContent.bind(this);
    this.onUpdateItemToFeed = this.onUpdateItemToFeed.bind(this);
    this.onAddLanguage = this.onAddLanguage.bind(this);
    this.onRemoveLanguage = this.onRemoveLanguage.bind(this);

    const $feedContent = document.getElementById('feed-content');
    const $dataParams = document.getElementById('lh-data-params');
    const onboardingResult = JSON.parse(unescapeHtml(document.getElementById('onboarding-result').innerHTML));

    const itemId = $dataParams ? $dataParams.getAttribute('data-item-id') : null;
    const action = itemId ? 'edit' : 'create';
    const feed = JSON.parse(unescapeHtml($feedContent.innerHTML));
    if (!feed.items) {
      feed.items = [];
    }
    
    // Migrate item to multi-language structure if needed
    const rawItem = feed.item || initItem();
    const item = migrateItemToMultiLanguage(rawItem);

    this.state = {
      feed,
      onboardingResult,
      item,
      submitStatus: null,
      itemId: itemId || randomShortUUID(),
      action,
      currentLanguage: item.languages && item.languages.length > 0 ? item.languages[0] : 'en',
      userChangedLink: false,
      changed: false,
    };
  }

  componentDidMount() {
    preventCloseWhenChanged(() => this.state.changed);

    const {action, item, currentLanguage} = this.state;
    if (action === 'create') {
      const {mediaFile} = item;
      const urlParams = new URLSearchParams(window.location.search);
      const title = urlParams.get('title') || '';

      const mediaFileFromUrl = getMediaFileFromUrl(urlParams);

      if (mediaFileFromUrl && Object.keys(mediaFileFromUrl).length > 0) {
        const attrDict = {
          mediaFile: {
            ...mediaFile,
            ...mediaFileFromUrl,
          },
        };
        // Set title in language-specific content
        if (title) {
          this.onUpdateItemContent(currentLanguage, {title});
        }
        this.onUpdateItemMeta(attrDict);
      }
    }
  }

  onUpdateFeed(props, onSuccess) {
    this.setState(prevState => ({
      feed: {
        ...prevState.feed,
        ...props,
      },
    }), () => onSuccess())
  }

  // Update non-language-specific item metadata
  onUpdateItemMeta(attrDict, extraDict) {
    this.setState(prevState => ({
      changed: true,
      item: {...prevState.item, ...attrDict,},
      ...extraDict,
    }));
  }

  // NEW: Update language-specific content
  onUpdateItemContent(language, attrDict, extraDict) {
    this.setState(prevState => ({
      changed: true,
      item: {
        ...prevState.item,
        content: {
          ...prevState.item.content,
          [language]: {
            ...prevState.item.content[language],
            ...attrDict,
          }
        }
      },
      ...extraDict,
    }));
  }

  // NEW: Add a new language to the item
  onAddLanguage(language) {
    const {item, currentLanguage} = this.state;
    
    if (item.languages.includes(language)) {
      showToast(`${LANGUAGE_NAMES[language]} is already enabled`, 'info');
      return;
    }

    // Initialize new language with empty content or copy image from current language
    const newContent = {
      title: '',
      description: '',
      image: item.content[currentLanguage]?.image || '', // Copy image by default
      link: '',
      'itunes:title': '',
    };

    this.setState(prevState => ({
      changed: true,
      item: {
        ...prevState.item,
        languages: [...prevState.item.languages, language],
        content: {
          ...prevState.item.content,
          [language]: newContent,
        }
      },
      currentLanguage: language, // Switch to newly added language
    }), () => {
      showToast(`${LANGUAGE_NAMES[language]} added`, 'success');
    });
  }

  // NEW: Remove a language from the item
  onRemoveLanguage(language) {
    const {item, currentLanguage} = this.state;
    
    if (item.languages.length === 1) {
      showToast('Cannot remove the last language', 'error');
      return;
    }

    const ok = confirm(`Are you sure you want to remove ${LANGUAGE_NAMES[language]}? This will delete all content in this language.`);
    if (!ok) return;

    const newLanguages = item.languages.filter(lang => lang !== language);
    const newContent = {...item.content};
    delete newContent[language];

    this.setState(prevState => ({
      changed: true,
      item: {
        ...prevState.item,
        languages: newLanguages,
        content: newContent,
      },
      currentLanguage: language === currentLanguage ? newLanguages[0] : currentLanguage,
    }), () => {
      showToast(`${LANGUAGE_NAMES[language]} removed`, 'success');
    });
  }

  onUpdateItemToFeed(onSuccess) {
    let {item, itemId, feed} = this.state;
    const itemsBundle = {
      ...feed.items,
      [itemId]: {...item},
    };
    this.onUpdateFeed({'items': itemsBundle}, onSuccess);
  }

  onDelete() {
    const {item} = this.state;
    this.setState({submitStatus: SUBMIT_STATUS__START});
    Requests.axiosPost(ADMIN_URLS.ajaxFeed(), {item: {...item, status: STATUSES.DELETED}})
      .then(() => {
        showToast('Deleted!', 'success');
        this.setState({submitStatus: null, changed: false}, () => {
          setTimeout(() => {
            location.href = ADMIN_URLS.allItems();
          }, 1000);
        });
      })
      .catch((error) => {
        this.setState({submitStatus: null}, () => {
          if (!error.response) {
            showToast('Network error. Please refresh the page and try again.', 'error');
          } else {
            showToast('Failed. Please try again.', 'error');
          }
        });
      });
  }

  onSubmit(e) {
    e.preventDefault();
    const {item, itemId, action} = this.state;
    
    // Flatten item for API compatibility
    const itemToSave = flattenItemForSave({id: itemId, ...item});
    
    this.setState({submitStatus: SUBMIT_STATUS__START});
    Requests.axiosPost(ADMIN_URLS.ajaxFeed(), {item: itemToSave})
      .then(() => {
        this.setState({submitStatus: null, changed: false}, () => {
          if (action === 'edit') {
            showToast('Updated!', 'success');
          } else {
            showToast('Created!', 'success');
            if (itemId) {
              setTimeout(() => {
                location.href = ADMIN_URLS.editItem(itemId);
              }, 1000);
            }
          }
        });
      }).catch((error) => {
      this.setState({submitStatus: null}, () => {
        if (!error.response) {
          showToast('Network error. Please refresh the page and try again.', 'error');
        } else {
          showToast('Failed. Please try again.', 'error');
        }
      });
    });
  }

  render() {
    const {submitStatus, itemId, item, action, feed, onboardingResult, changed, currentLanguage} = this.state;
    const submitting = submitStatus === SUBMIT_STATUS__START;
    const {mediaFile, languages, content} = item;
    const status = item.status || STATUSES.PUBLISHED;

    // Get content for current language
    const currentContent = content[currentLanguage] || {};

    const webGlobalSettings = feed.settings.webGlobalSettings || {};
    const publicBucketUrl = webGlobalSettings.publicBucketUrl || '';

    let buttonText = 'Create';
    let submittingButtonText = 'Creating...';
    let currentPage = NAV_ITEMS.NEW_ITEM;
    let upperLevel;
    if (action === 'edit') {
      buttonText = 'Update';
      submittingButtonText = 'Updating...';
      currentPage = NAV_ITEMS.ALL_ITEMS;
      upperLevel = {
        name: NAV_ITEMS_DICT[NAV_ITEMS.ALL_ITEMS].name,
        url: ADMIN_URLS.allItems(),
        childName: `Item (id = ${itemId})`,
      };
    }

    // Available languages to add
    const availableLanguagesToAdd = SUPPORTED_LANGUAGES.filter(lang => !languages.includes(lang));

    return (<AdminNavApp
      currentPage={currentPage}
      upperLevel={upperLevel}
      onboardingResult={onboardingResult}
    >
      <form className="grid grid-cols-12 gap-4">
        <div className="col-span-9 grid grid-cols-1 gap-4">
          
          {/* NEW: Language Selector Section */}
          <div className="lh-page-card">
            <h2 className="lh-page-title mb-4">Languages</h2>
            <div className="flex flex-wrap items-center gap-2">
              {languages.map(lang => (
                <button
                  key={lang}
                  type="button"
                  className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${
                    currentLanguage === lang 
                      ? 'bg-brand-dark text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                  onClick={() => this.setState({currentLanguage: lang})}
                >
                  {LANGUAGE_NAMES[lang]}
                  {languages.length > 1 && (
                    <XMarkIcon 
                      className="w-4 h-4 hover:text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        this.onRemoveLanguage(lang);
                      }}
                    />
                  )}
                </button>
              ))}
              
              {/* Add language dropdown */}
              {availableLanguagesToAdd.length > 0 && (
                <div className="relative inline-block">
                  <select
                    className="appearance-none px-4 py-2 pr-8 rounded-lg border border-gray-300 bg-white hover:border-brand-light cursor-pointer"
                    onChange={(e) => {
                      if (e.target.value) {
                        this.onAddLanguage(e.target.value);
                        e.target.value = ''; // Reset select
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>+ Add language</option>
                    {availableLanguagesToAdd.map(lang => (
                      <option key={lang} value={lang}>{LANGUAGE_NAMES[lang]}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="mt-2 text-sm text-helper-color">
              Editing content for: <strong>{LANGUAGE_NAMES[currentLanguage]}</strong>
            </div>
          </div>

          {/* Media File Section - Shared across all languages */}
          <div className="lh-page-card">
            <div className="mb-2 text-sm text-helper-color">
              ℹ️ Media files are shared across all languages
            </div>
            <MediaManager
              labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.MEDIA_FILE]}/>}
              feed={feed}
              initMediaFile={mediaFile || {}}
              onMediaFileUpdated={(newMediaFile) => {
                this.onUpdateItemMeta({
                  mediaFile: {
                    ...mediaFile,
                    ...newMediaFile,
                  },
                });
              }}
            />
          </div>
          
          {/* Language-specific Content Section */}
          <div className="lh-page-card">
            <div className="flex">
              <div>
                <ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.IMAGE]}/>
                <AdminImageUploaderApp
                  mediaType="item"
                  feed={feed}
                  currentImageUrl={currentContent.image}
                  onImageUploaded={(cdnUrl) => this.onUpdateItemContent(currentLanguage, {'image': cdnUrl})}
                />
              </div>
              <div className="ml-8 flex-1">
                <AdminInput
                  labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.TITLE]}/>}
                  value={currentContent.title || ''}
                  onChange={(e) => {
                    const attrDict = {'title': e.target.value};
                    if (action !== 'edit' && !this.state.userChangedLink) {
                      attrDict.link = PUBLIC_URLS.webItem(itemId, e.target.value, getPublicBaseUrl());
                    }
                    this.onUpdateItemContent(currentLanguage, attrDict);
                  }}
                />
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <AdminDatetimePicker
                    labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.PUB_DATE]}/>}
                    value={item.pubDateMs}
                    onChange={(e) => {
                      this.onUpdateItemMeta({'pubDateMs': datetimeLocalStringToMs(e.target.value)});
                    }}
                  />
                  <AdminInput
                    labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.LINK]}/>}
                    value={currentContent.link || ''}
                    onChange={(e) => this.onUpdateItemContent(currentLanguage, {'link': e.target.value}, {userChangedLink: true})}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 mt-4">
                  <AdminRadio
                    labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.STATUS]}/>}
                    groupName="item-status"
                    buttons={[
                      {
                        name: ITEM_STATUSES_DICT[STATUSES.PUBLISHED].name,
                        value: STATUSES.PUBLISHED,
                        checked: status === STATUSES.PUBLISHED,
                      },
                      {
                        name: ITEM_STATUSES_DICT[STATUSES.UNLISTED].name,
                        value: STATUSES.UNLISTED,
                        checked: status === STATUSES.UNLISTED,
                      },
                      {
                        name: ITEM_STATUSES_DICT[STATUSES.UNPUBLISHED].name,
                        value: STATUSES.UNPUBLISHED,
                        checked: status === STATUSES.UNPUBLISHED,
                      }]}
                    onChange={(e) => {
                      this.onUpdateItemMeta({'status': parseInt(e.target.value, 10)})
                    }}
                  />
                  <div className="text-muted-color text-xs" dangerouslySetInnerHTML={{__html: ITEM_STATUSES_DICT[status].description}} />
                </div>
              </div>
            </div>
            <div className="mt-8 pt-8 border-t">
              <AdminRichEditor
                labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.DESCRIPTION]}/>}
                value={currentContent.description || ''}
                onChange={(value) => this.onUpdateItemContent(currentLanguage, {'description': value})}
                extra={{
                  publicBucketUrl,
                  folderName: `items/${itemId}/${currentLanguage}`,
                }}
              />
            </div>
          </div>
          <div className="lh-page-card">
            <details>
              <summary className="m-page-summary">Podcast-specific fields</summary>
              <div className="grid grid-cols-1 gap-8">
                <div className="grid grid-cols-3 gap-4 mt-4">
                  <AdminRadio
                    labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.ITUNES_EXPLICIT]}/>}
                    groupName="lh-explicit"
                    buttons={[{
                      'name': 'yes',
                      'checked': item['itunes:explicit'],
                    }, {
                      'name': 'no',
                      'checked': !item['itunes:explicit'],
                    }]}
                    value={item['itunes:explicit']}
                    onChange={(e) => this.onUpdateItemMeta({'itunes:explicit': e.target.value === 'yes'})}
                  />
                  <AdminInput
                    labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.GUID]}/>}
                    value={item.guid || itemId}
                    setRef={(ref) => {
                      if (!item.guid && ref) {
                        this.onUpdateItemMeta({'guid': ref.value}, {changed: false});
                      }
                    }}
                    onChange={(e) => this.onUpdateItemMeta({'guid': e.target.value})}
                  />
                  <AdminInput
                    labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.ITUNES_TITLE]}/>}
                    value={currentContent['itunes:title'] || ''}
                    onChange={(e) => this.onUpdateItemContent(currentLanguage, {'itunes:title': e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <AdminRadio
                    labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.ITUNES_EPISODE_TYPE]}/>}
                    groupName="feed-itunes-episodetype"
                    buttons={[{
                      'name': 'full',
                      'checked': item['itunes:episodeType'] === 'full',
                    }, {
                      'name': 'trailer',
                      'checked': item['itunes:episodeType'] === 'trailer',
                    }, {
                      'name': 'bonus',
                      'checked': item['itunes:episodeType'] === 'bonus',
                    },
                    ]}
                    value={item['itunes:episodeType']}
                    onChange={(e) => this.onUpdateItemMeta({'itunes:episodeType': e.target.value})}
                  />
                  <AdminInput
                    type="number"
                    labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.ITUNES_SEASON]}/>}
                    value={item['itunes:season']}
                    extraParams={{min: "1"}}
                    onChange={(e) => this.onUpdateItemMeta({'itunes:season': e.target.value})}
                  />
                  <AdminInput
                    type="number"
                    labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.ITUNES_EPISODE]}/>}
                    value={item['itunes:episode']}
                    extraParams={{min: "1"}}
                    onChange={(e) => this.onUpdateItemMeta({'itunes:episode': e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <AdminRadio
                    labelComponent={<ExplainText bundle={CONTROLS_TEXTS_DICT[ITEM_CONTROLS.ITUNES_BLOCK]}/>}
                    groupName="feed-itunes-block"
                    buttons={[{
                      'name': 'Yes',
                      'checked': item['itunes:block'],
                    }, {
                      'name': 'No',
                      'checked': !item['itunes:block'],
                    }]}
                    value={item['itunes:block']}
                    onChange={(e) => this.onUpdateItemMeta({'itunes:block': e.target.value === 'Yes'})}
                  />
                </div>
              </div>
            </details>
          </div>
        </div>
        <div className="col-span-3">
          <div className="sticky top-8">
            <div className="lh-page-card text-center">
              <button
                type="submit"
                className="lh-btn lh-btn-brand-dark lh-btn-lg"
                onClick={this.onSubmit}
                disabled={submitting || !changed}
              >
                {submitting ? submittingButtonText : buttonText}
              </button>
            </div>
            {action === 'edit' && <div>
              <AdminSideQuickLinks
                AdditionalLinksDiv={<div className="flex flex-wrap">
                  <SideQuickLink url={PUBLIC_URLS.webItem(itemId, currentContent.title)} text="web item"/>
                  <SideQuickLink url={PUBLIC_URLS.jsonItem(itemId)} text="json item"/>
                </div>}
              />
              <div className="lh-page-card mt-4 flex justify-center">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    const ok = confirm('Are you going to permanently delete this item?');
                    if (ok) {
                      this.onDelete();
                    }
                  }
                }><div className="flex items-center text-red-500 text-sm hover:text-brand-light">
                  <TrashIcon className="w-4" />
                  <div className="ml-1">Delete this item</div>
                  </div>
                </a>
              </div>
            </div>}
          </div>
        </div>
      </form>
    </AdminNavApp>);
  }
}
