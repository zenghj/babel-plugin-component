const { addSideEffect, addDefault } = require('@babel/helper-module-imports');
const resolve = require('path').resolve;
const isExist = require('fs').existsSync;
const cache = {};
const cachePath = {};
const importAll = {};

// {
//   "presets": [["es2015", { "modules": false }]],
//   "plugins": [
//     [
//       "component",
//       {
//         "libraryName": "element-ui",
//         "styleLibraryName": "theme-chalk"
//       }
//     ]
//   ]
// }
/**
 * 
 * @param {*} defaultLibraryName 'element-ui' 
 */
module.exports = function core(defaultLibraryName) {
  return ({ types }) => {
    let specified;
    let libraryObjs;
    let selectedMethods;
    let moduleArr;

    /**
     * 驼峰命名转成横杠链接 MyInput --> my-input
     * @param {*} _str 
     * @param {*} camel2Dash 
     */
    function parseName(_str, camel2Dash) {
      if (!camel2Dash) {
        return _str;
      }
      const str = _str[0].toLowerCase() + _str.substr(1);
      return str.replace(/([A-Z])/g, ($1) => `-${$1.toLowerCase()}`);
    }

    /**
     * 
     * @param {*} methodName 为localName
     * @param {*} file 
     * @param {*} opts 
     */
    function importMethod(methodName, file, opts) {
      if (!selectedMethods[methodName]) {
        // 处理options，初始化默认值
        let options;
        let path;

        if (Array.isArray(opts)) {
          options = opts.find(option =>
            moduleArr[methodName] === option.libraryName ||
            libraryObjs[methodName] === option.libraryName
          ); // eslint-disable-line
        }
        options = options || opts;

        const {
          libDir = 'lib',
          libraryName = defaultLibraryName,
          style = true,
          styleLibrary,
          root = '',
          camel2Dash = true,
        } = options;
        let styleLibraryName = options.styleLibraryName;
        let _root = root;
        let isBaseStyle = true;
        let modulePathTpl;
        let styleRoot;
        let mixin = false;
        const ext = options.ext || '.css';

        if (root) {
          _root = `/${root}`;
        }

        // import ElementUI from 'element-ui'
        if (libraryObjs[methodName]) {
          path = `${libraryName}/${libDir}${_root}`; // "element-ui/lib"
          if (!_root) { // 未设置root标记为全量引入
            importAll[path] = true;
          }
        } else {
          // 'element-ui/lib/button'
          path = `${libraryName}/${libDir}/${parseName(methodName, camel2Dash)}`;
        }
        const _path = path;

        // 在节点所属文件顶部添加一行default导入
        selectedMethods[methodName] = addDefault(file.path, path, { nameHint: methodName });
        if (styleLibrary && typeof styleLibrary === 'object') {
          styleLibraryName = styleLibrary.name;
          isBaseStyle = styleLibrary.base;
          modulePathTpl = styleLibrary.path;
          mixin = styleLibrary.mixin;
          styleRoot = styleLibrary.root;
        }
        if (styleLibraryName) {
          if (!cachePath[libraryName]) {
            const themeName = styleLibraryName.replace(/^~/, '');
            cachePath[libraryName] = styleLibraryName.indexOf('~') === 0
              ? resolve(process.cwd(), themeName)
              : `${libraryName}/${libDir}/${themeName}`;
          }

          if (libraryObjs[methodName]) {
            /* istanbul ingore next */
            if (cache[libraryName] === 2) {
              throw Error('[babel-plugin-component] If you are using both' +
                'on-demand and importing all, make sure to invoke the' +
                ' importing all first.');
            }
            if (styleRoot) {
              path = `${cachePath[libraryName]}${styleRoot}${ext}`;
            } else {
              path = `${cachePath[libraryName]}${_root || '/index'}${ext}`;
            }
            cache[libraryName] = 1;
          } else {
            if (cache[libraryName] !== 1) {
              /* if set styleLibrary.path(format: [module]/module.css) */
              const parsedMethodName = parseName(methodName, camel2Dash);
              if (modulePathTpl) {
                const modulePath = modulePathTpl.replace(/\[module]/ig, parsedMethodName);
                path = `${cachePath[libraryName]}/${modulePath}`;
              } else {
                path = `${cachePath[libraryName]}/${parsedMethodName}${ext}`;
              }
              if (mixin && !isExist(path)) {
                path = style === true ? `${_path}/style${ext}` : `${_path}/${style}`;
              }
              if (isBaseStyle) {
                addSideEffect(file.path, `${cachePath[libraryName]}/base${ext}`);
              }
              cache[libraryName] = 2;
            }
          }

          addDefault(file.path, path, { nameHint: methodName });
        } else {
          if (style === true) {
            addSideEffect(file.path, `${path}/style${ext}`);
          } else if (style) {
            // addSideEffect(path, 'source');
            // import "source"
            addSideEffect(file.path, `${path}/${style}`);
          }
        }
      }
      return selectedMethods[methodName];
    }

    function buildExpressionHandler(node, props, path, state) {
      const file = (path && path.hub && path.hub.file) || (state && state.file);
      props.forEach(prop => {
        if (!types.isIdentifier(node[prop])) return;
        if (specified[node[prop].name]) {
          node[prop] = importMethod(node[prop].name, file, state.opts); // eslint-disable-line
        }
      });
    }

    /**
     * 
     * @param {*} node 
     * @param {*} prop 
     * @param {*} path 
     * @param {*} state 
     */
    function buildDeclaratorHandler(node, prop, path, state) {
      const file = (path && path.hub && path.hub.file) || (state && state.file);
      if (!types.isIdentifier(node[prop])) return;
      if (specified[node[prop].name]) {
        node[prop] = importMethod(node[prop].name, file, state.opts); // eslint-disable-line
      }
    }

    return {
      visitor: {
        /**
         * Program节点，AST根结点，初始化一些值
         */
        Program() {
          // 按需加载组件名称map, [localName]: importedName
          specified = Object.create(null);

          // 记录导入的库,通过default导入的，import name from 'module-name'
          // {MyElementUI: 'element-ui'}, [localName]: moduleName
          libraryObjs = Object.create(null);

          selectedMethods = Object.create(null);

          // 记录导入的模块, 非default导入的，import { name } from 'module-name'
          // {Input: 'element-ui'}, [ImportedName]: moduleName
          moduleArr = Object.create(null);
        },

        /**
         * 收集所有模块（特定的模块，配置的需要按需加载的模块）导入
         * import "module-name"
         * @param {BabelPath} path 处理的AST节点的路径，和节点
         * @param {Object} context
         * @param {any} context.opts 插件调用传的参数，类型应该是任意的，看插件开发者如何定义
         */
        ImportDeclaration(path, { opts }) {
          const { node } = path; // path.node AST节点
          // node.source StringLiteral
          const { value } = node.source; // node.source.value 即 "module-name" 'element-ui'
          let result = {};

          if (Array.isArray(opts)) {
            result = opts.find(option => option.libraryName === value) || {};
          }
          const libraryName = result.libraryName || opts.libraryName || defaultLibraryName; // 'element-ui' 或者需要按需加载的库名称

          // import { Button, Input } from 'element-ui'
          if (value === libraryName) { // 在导入需要按需加载的组件库
            node.specifiers.forEach(spec => { // Button, Input 节点
              if (types.isImportSpecifier(spec)) { // import ElementUI from "element-ui"， 这种ImportDefaultSpecifier类型不算
                // import { Button as MyButton } from "element-ui" 
                // spec.local.name为'MyButton'；spec.imported.name为'Button'
                // import { Button } from 'element-ui' 这种情况 spec.local.name和spec.imported.name都是'Button'
                specified[spec.local.name] = spec.imported.name; 
                moduleArr[spec.imported.name] = value;
                // moduleArr = {
                //   'Button': 'element-ui'
                // }
              } else { // 应该就是default导入
                libraryObjs[spec.local.name] = value;
              }
            });

            // 非全量引入，则删除当前节点？
            if (!importAll[value]) {
              path.remove();
            }
          }
        },

        /**
         * 函数调用节点
         * @param {*} path 
         * @param {*} state 
         */
        CallExpression(path, state) {
          const { node } = path;
          const file = (path && path.hub && path.hub.file) || (state && state.file);
          // node.callee
          // node.callee.name 调用的函数名称，匿名函数时值为undefined
          const { name } = node.callee;

          if (types.isIdentifier(node.callee)) { // 是否为标识符节点
            if (specified[name]) { // specified有记录, 意思就是导入的函数有调用，则导入该方法
              node.callee = importMethod(specified[name], file, state.opts);
            }
          } else { // 比如MemberExpression
            node.arguments = node.arguments.map(arg => {
              const { name: argName } = arg;
              if (specified[argName]) {
                return importMethod(specified[argName], file, state.opts);
              } else if (libraryObjs[argName]) {
                return importMethod(argName, file, state.opts);
              }
              return arg;
            });
          }
        },

        /**
         * 对象方法调用表达式 obj.a()
         * 导入的模块localName作为对象执行其方法则导入该模块
         * @param {*} path 
         * @param {*} state 
         */
        MemberExpression(path, state) {
          const { node } = path;
          const file = (path && path.hub && path.hub.file) || (state && state.file);

          if (libraryObjs[node.object.name] || specified[node.object.name]) { // node.object.name 该方法所属对象的名称
            node.object = importMethod(node.object.name, file, state.opts);
          }
        },

        /**
         * 赋值表达式节点
         * 导入的模块localName作为值赋个某个变量，则导入该模块
         * var a = 1 为ExpressionStatement
         * a = 1 为AssignmentExpression
         * @param {*} path 
         * @param {*} param1 
         */
        AssignmentExpression(path, { opts }) {
          if (!path.hub) {
            return;
          }
          const { node } = path;
          const { file } = path.hub;

          if (node.operator !== '=') return;
          if (libraryObjs[node.right.name] || specified[node.right.name]) {
            node.right = importMethod(node.right.name, file, opts);
          }
        },

        /**
         * 数组节点
         * 导入模块localName作为数组元素出现，则导入该模块
         * @param {*} path 
         * @param {*} param1 
         */
        ArrayExpression(path, { opts }) {
          if (!path.hub) {
            return;
          }
          const { elements } = path.node;
          const { file } = path.hub;

          // elements 数组元素节点列表
          // [Button, Input]
          elements.forEach((item, key) => {
            // item.name 为 ‘Button’
            if (item && (libraryObjs[item.name] || specified[item.name])) {
              elements[key] = importMethod(item.name, file, opts);
            }
          });
        },

        /**
         * 对象属性节点
         * 导入的模块localName作为属性值出现时，导入该模块
         * obj = { prop1: 1}
         * @param {*} path 
         * @param {*} state 
         */
        Property(path, state) {
          const { node } = path;
          buildDeclaratorHandler(node, 'value', path, state);
        },

        /**
         * 变量声明节点
         * var myInput = Input
         * @param {*} path 
         * @param {*} state 
         */
        VariableDeclarator(path, state) {
          const { node } = path;
          buildDeclaratorHandler(node, 'init', path, state);
        },

        /**
         * 逻辑表达式 类似 a || b
         * Input || TextArea 
         * @param {*} path 
         * @param {*} state 
         */
        LogicalExpression(path, state) {
          const { node } = path;
          buildExpressionHandler(node, ['left', 'right'], path, state);
        },

        /**
         * 条件判断表达式 比如 a > b ? 1 : 0
         * a > 0 ? Input : TextArea
         * @param {*} path 
         * @param {*} state 
         */
        ConditionalExpression(path, state) {
          const { node } = path;
          buildExpressionHandler(node, ['test', 'consequent', 'alternate'], path, state);
        },

        /**
         * if语句
         * if (Input) {}
         * @param {*} path 
         * @param {*} state 
         */
        IfStatement(path, state) {
          const { node } = path;
          buildExpressionHandler(node, ['test'], path, state);
          buildExpressionHandler(node.test, ['left', 'right'], path, state);
        },
      },
    };
  };
};
