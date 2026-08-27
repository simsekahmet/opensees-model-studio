/**
 * version.js — one place that says which release this is.
 *
 * `APP_VERSION` is shown in the sidebar footer, written into the header of
 * every generated script and stamped into exported project files.
 * `PROJECT_FORMAT` changes only when the saved project shape changes in a way
 * that older files cannot be read into.
 */

export const APP_VERSION = '1.5.4';
export const PROJECT_FORMAT = 1;

/** Python versions the generated scripts are known to run on. */
export const PYTHON_SUPPORT = {
  tested: '3.12',
  range: '3.9 – 3.13',
  unsupported: '3.14',
};
