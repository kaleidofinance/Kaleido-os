"use client";

import React from 'react';
import { FunctionDefinition } from './functionRegistry';
import { FiZap, FiKey, FiBox } from 'react-icons/fi';
import { ExecutionKeyword } from './FunctionComponents';

interface ActionsPanelProps {
  functions: FunctionDefinition[];
  onFunctionSelect: (functionId: string) => void;
}

// Component that displays available automated actions
const ActionsPanel: React.FC<ActionsPanelProps> = ({ functions, onFunctionSelect }) => {
  // Group functions by category (wallet-related vs non-wallet)
  const walletFunctions = functions.filter(f => f.requiresWallet);
  const generalFunctions = functions.filter(f => !f.requiresWallet);

  if (!functions || functions.length === 0) {
    return (
      <div className="bg-green-50 border-b border-green-100 p-8 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-100 flex items-center justify-center">
          <FiZap className="text-green-500 text-xl" />
        </div>
        <div className="text-sm font-medium text-green-700">No actions available</div>
        <div className="text-xs mt-1 text-green-600">Please connect your wallet to see available actions</div>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border-b border-green-100 max-h-64 overflow-y-auto chatbot-actions-dropdown">
      <div className="p-2 bg-gradient-to-r from-green-600 to-green-700 text-sm text-white font-medium">
        Available Actions
      </div>
      
      {/* General functions section */}
      {generalFunctions.length > 0 && (
        <>
          <div className="p-1 px-2 bg-green-100 text-xs font-medium text-green-700">
            General Actions
          </div>
          <ul className="divide-y divide-green-100 chatbot-actions-list">
            {/* Guided tour trigger as a general action */}
            <li
              key="guided-tour-deposit-collateral"
              className="transition-colors border-l-0 border-l-green-500 hover:border-l-4 hover:bg-green-100/50 cursor-pointer"
              onClick={() => window.dispatchEvent(new CustomEvent('startDashboardTour'))}
            >
              <div className="flex items-start p-3">
                <FiBox className="text-green-500 mt-1 mr-2" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-green-600">How to deposit collateral</div>
                  <div className="text-xs text-gray-700 mt-1">Take a guided tour of the dashboard to learn how to deposit collateral.</div>
                  <div className="text-xs text-green-600 mt-1">
                    Quick command: <span className="execution-keyword">deposit collateral</span>
                  </div>
                </div>
              </div>
            </li>
            {generalFunctions.map((func) => (
              <li 
                key={func.id} 
                className="transition-colors border-l-0 border-l-green-500 hover:border-l-4 hover:bg-green-100/50 cursor-pointer"
                onClick={() => onFunctionSelect(func.id)}
              >              <div className="flex items-start p-3">
              <FiBox className="text-green-500 mt-1 mr-2" />
              <div className="flex-1">                <div className="text-sm font-medium text-green-600">{func.name}</div>
                <div className="text-xs text-gray-700 mt-1">{func.description}</div>
                {/* Quick command from patterns for demonstration */}
                <div className="text-xs text-green-600 mt-1">
                  Quick command: <span className="execution-keyword">{func.patterns[0]}</span>
                </div>
              </div>
            </div>
              </li>
            ))}
          </ul>
        </>
      )}
      
      {/* Wallet functions section */}
      {walletFunctions.length > 0 && (
        <>
          <div className="p-1 px-2 bg-green-100 text-xs font-medium text-green-700">
            Wallet Actions
          </div>
          <ul className="divide-y divide-green-100 chatbot-actions-list">
            {walletFunctions.map((func) => (
              <li 
                key={func.id} 
                className="transition-colors border-l-0 border-l-green-500 hover:border-l-4 hover:bg-green-100/50 cursor-pointer"
                onClick={() => onFunctionSelect(func.id)}
              >
                <div className="flex items-start p-3">
                  <FiKey className="text-green-500 mt-1 mr-2" />
                  <div className="flex-1">                    <div className="text-sm font-medium text-green-600">{func.name}</div>
                    <div className="text-xs text-gray-700 mt-1">{func.description}</div>                <div className="text-xs text-orange-500 mt-1 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clipRule="evenodd" />
                  </svg>
                  Requires wallet connection
                </div>
                <div className="text-xs text-green-600 mt-1">
                  Quick command: <ExecutionKeyword word={func.patterns[0]} description={func.description} />
                </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Quick tips section */}
      <div className="p-2 bg-green-100 text-xs">        <div className="font-medium text-green-700">Usage Tips</div>        <div className="text-gray-600 mt-1">          You can also trigger these actions by chatting with Luca. Try asking about your
          <ExecutionKeyword word="wallet balance" description="Check your wallet balance" /> or 
          <ExecutionKeyword word="loan risk" description="Check your loan risk score" /> 
          for quick access.
        </div>
      </div>
    </div>
  );
};

export default ActionsPanel;
