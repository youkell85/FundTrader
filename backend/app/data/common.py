"""通用数据处理模块 - 提取重复的数据获取和错误处理逻辑"""

from typing import List, Dict, Any, Optional, Callable
from ..utils.common_utils import safe_execute, normalize_nav_data
from ..utils import console_error


def get_nav_history_with_fallback(
    code: str, 
    primary_func: Callable, 
    fallback_func: Callable,
    error_msg_prefix: str = "Fusion nav history fallback"
) -> List[Dict[str, Any]]:
    """带fallback的净值历史获取函数"""
    # 尝试主数据源
    result = safe_execute(
        lambda: primary_func(code),
        default=None,
        error_msg_prefix=f"{error_msg_prefix} for {code}"
    )
    
    if result:
        # 如果主数据源成功，标准化格式
        if hasattr(result[0], 'date') if result else False:  # 检查是否是对象而非字典
            return normalize_nav_data(result)
        else:
            return result
    
    # 主数据源失败，使用fallback
    return fallback_func(code)


def merge_data_with_fallback(
    primary_func: Callable,
    fallback_func: Callable,
    error_msg_prefix: str = "Data merge fallback"
) -> Any:
    """带fallback的数据合并函数"""
    # 尝试主数据源
    result = safe_execute(primary_func, default=None, error_msg_prefix=error_msg_prefix)
    
    if result:
        return result
    
    # 主数据源失败，使用fallback
    return fallback_func()


def execute_with_error_handling(
    func: Callable, 
    error_msg: str, 
    default_value: Any = None
) -> Any:
    """执行函数并处理错误"""
    try:
        return func()
    except Exception as e:
        console_error(f"{error_msg}: {e}")
        return default_value


def get_fund_detail_with_fallback(
    code: str,
    providers: List,
    detail_extractor: Callable,
    merger: Callable
) -> Optional[Any]:
    """带fallback的基金详情获取函数"""
    primary = None
    available_providers = [p for p in providers if p.is_available()]
    
    # 主数据源：取优先级最高的完整数据
    for provider in available_providers:
        detail = execute_with_error_handling(
            lambda: detail_extractor(provider, code),
            f"Provider {provider.name} detail error"
        )
        
        if detail:
            primary = detail
            break
    
    if primary is None:
        return None
    
    # 补充数据源：合并其他数据源的非空字段
    for provider in available_providers:
        if provider.name == primary.source:
            continue
            
        detail = execute_with_error_handling(
            lambda: detail_extractor(provider, code),
            f"Provider {provider.name} merge error"
        )
        
        if not detail:
            continue
            
        # 合并字段逻辑
        primary = merger(primary, detail)
    
    return primary


def merge_multiple_sources(
    code: str,
    providers: List,
    data_extractor: Callable,
    error_msg_prefix: str = "Data source error"
) -> List:
    """从多个数据源合并数据"""
    all_items = []
    available_providers = [p for p in providers if p.is_available()]
    
    for provider in available_providers:
        items = execute_with_error_handling(
            lambda: data_extractor(provider, code),
            f"{error_msg_prefix} for {provider.name}"
        )
        
        if items is not None:
            all_items.extend(items)
    
    return all_items